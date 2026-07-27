import type { EventBridgeHandler } from 'aws-lambda';

// Payload documentado em https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/eventbridge.html —
// o nome do evento fica em detail.event_name, nunca no detail-type (ver docs/fase-1-arquitetura.md).
type IvsEventDetail = {
  event_name: string;
  event_time: string;
  session_id?: string;
  participant_id?: string;
};

type IvsDetailType =
  'IVS Stage Update' | 'IVS Composition State Change' | 'IVS Participant Recording State Change';

// Fase 7 implementa: iniciar/parar composição, atualizar o estado de Recording no
// DynamoDB de forma condicional por event_time (evento fora de ordem é descartado, não
// aplicado — decisão registrada em docs/fase-1-arquitetura.md, seção 5).
// Por enquanto só garante que as três regras do EventBridge tenham um alvo implantável.
export const handler: EventBridgeHandler<IvsDetailType, IvsEventDetail, void> = async () => {
  return;
};
