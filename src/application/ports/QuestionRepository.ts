import type { Question } from '@/domain/entities/Question';

export interface QuestionRepository {
  save(question: Question): Promise<void>;
  find(liveId: string, questionId: string): Promise<Question | null>;
  listByLive(liveId: string): Promise<readonly Question[]>;
}
