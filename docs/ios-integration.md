# Integração do app iOS — orientações (seção 13 do README)

Este documento **não implementa** o app SwiftUI (fora do escopo desta fase). Prepara
o contrato para quando ele for construído: fluxo de autenticação, integração com o
SDK do Amazon IVS, e as diferenças em relação ao painel web (que é um BFF; o app iOS
fala com `/api/v1/*` diretamente).

## 1. Autenticação

O app iOS usa o **client público** do Cognito (`CognitoStack.mobileClient` —
`infrastructure/stacks/cognito-stack.ts`, sem secret, `authFlows.userSrp`), autenticando
via SRP diretamente no dispositivo — **não** o fluxo OAuth/Hosted UI do painel web
(esse é exclusivo do client confidencial, que precisa de um servidor para guardar o
secret).

Bibliotecas recomendadas: Amplify Auth for Swift, ou `AWSCognitoIdentityProvider`
diretamente. Fluxo:

1. `InitiateAuth` (`USER_SRP_AUTH`) com o `mobileClient` id.
2. Completar o desafio SRP (a biblioteca faz isso automaticamente).
3. Guardar `access_token`/`refresh_token`/`id_token` no Keychain (nunca em
   `UserDefaults` ou disco não criptografado).
4. Toda chamada a `/api/v1/*` leva `Authorization: Bearer {access_token}`.
5. Quando `access_token` expirar (60min — `accessTokenValidity` do client),
   renovar via `refresh_token` (`REFRESH_TOKEN_AUTH`), transparente ao usuário
   por até 30 dias (`refreshTokenValidity`).

`role`/`institutionId` nunca vêm de um claim do token — o backend sempre resolve
isso via `UserProfile` (mesma regra do painel, docs/fase-1-arquitetura.md, seção 2).
O app não precisa (e não deve) tentar ler/confiar em claims de autorização do JWT.

## 2. Contrato da API

Ver `docs/openapi.yaml` — `/api/v1/*`, Bearer JWT, envelope `{data, meta}` /
`{error: {code, message, details, requestId}}`. Trate os estados de carregamento e
erro da UI reagindo a `error.code` (estável), nunca a `error.message` (texto em
português, pode mudar).

## 3. Estúdio — IVS Broadcast SDK (iOS)

Equivalente nativo do que o painel web faz com `amazon-ivs-web-broadcast`
(`src/web/studio/StudioClient.tsx`):

1. `POST /api/v1/lives/{liveId}/join` → `ivs.participantToken` + `ivs.expiresAt`.
2. Criar uma `IVSStage` (Broadcast SDK for iOS) com esse token, implementar
   `IVSStageStrategy` (mesmos três métodos do SDK web: quais streams publicar,
   se publica, se assina participantes remotos).
3. **Renovação de token, sem derrubar a publicação**: chamar
   `POST /api/v1/lives/{liveId}/token/refresh` ANTES de `expiresAt` (o SDK web
   usa uma margem de 10min — replique isso) e aplicar o novo token via o
   mecanismo de troca de token do SDK iOS (equivalente ao `exchangeToken` do SDK
   web — consulte a referência do IVS Broadcast SDK for iOS para o nome exato
   do método na versão em uso; o CONTRATO do lado do servidor é o mesmo).
4. Teste de câmera/microfone: usar `AVCaptureSession` para preview local ANTES de
   chamar `stage.join()` — mesma ideia do preview via `getUserMedia` no painel
   web, só a API nativa muda.

## 4. WebSocket — heartbeat, retomada e reconexão preventiva

Mesmo contrato do painel web (`src/web/realtime/use-live-connection.ts`,
docs/fase-1-arquitetura.md seção 10.8/10.9):

- Conectar em `wss://{apiId}.execute-api.{region}.amazonaws.com/{stage}?ticket={connectionToken}`.
- Heartbeat (`{"action": "ping"}`) a cada ~5min (teto de 10min de conexão ociosa,
  fixo, não ajustável).
- Reconexão preventiva num ponto aleatório entre 1h45 e 1h55 de conexão (teto de
  2h, fixo) — pedir um ticket novo via
  `POST /api/v1/lives/{liveId}/realtime/ticket` (nunca `/join` de novo) e abrir a
  conexão nova ANTES de fechar a velha.
- Ao reconectar, enviar `{"action": "sync.resume", "since": <timestamp do último
  evento recebido>}` para recuperar mensagens/perguntas/enquetes perdidas durante
  a lacuna.

## 5. Cookies assinados no iOS (replay de gravações)

`GET /api/v1/recordings/{recordingId}/playback` devolve `manifestUrl` e os três
valores do cookie assinado do CloudFront em JSON (não `Set-Cookie` — o servidor não
sabe fazer isso para um cliente nativo). O app deve:

1. Construir três `HTTPCookie` (`CloudFront-Policy`, `CloudFront-Signature`,
   `CloudFront-Key-Pair-Id`) com `domain`/`path` = o domínio/`cookiePath` da
   resposta, `secure: true`, e inserir no `HTTPCookieStorage.shared` (ou no
   `HTTPCookieStorage` da `URLSession` usada pelo player) ANTES de pedir
   `manifestUrl`.
2. Reproduzir com `AVPlayer` normalmente — os cookies vão automaticamente em
   toda requisição para o mesmo domínio (manifesto + segmentos), igual ao
   navegador.

Diferente do painel web, o app iOS **não depende de cookie first-party
entre domínios** (`URLSession` tem cookie store próprio, isolado por app, não
pelas regras de terceiros do navegador) — mas ainda assim precisa gravar os TRÊS
valores antes de reproduzir, ou os segmentos vêm com 403.
