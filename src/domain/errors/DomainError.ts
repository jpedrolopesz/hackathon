export abstract class DomainError extends Error {
  readonly code: string;

  /** Mensagem em pt-BR, segura para retornar ao cliente. Nunca contém IDs, ARNs ou nomes de recurso. */
  readonly publicMessage: string;

  /** Mensagem em inglês para CloudWatch. Pode conter identificadores; nunca é serializada na resposta HTTP. */
  readonly internalMessage: string;

  constructor(publicMessage: string, code: string, internalMessage: string = publicMessage) {
    super(internalMessage);
    this.name = new.target.name;
    this.code = code;
    this.publicMessage = publicMessage;
    this.internalMessage = internalMessage;
  }
}
