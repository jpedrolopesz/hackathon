import type { UserProfileRepository } from '@/application/ports/UserProfileRepository';
import type { UserProfile } from '@/domain/entities/UserProfile';

/**
 * Sem checagem de autorização própria: é o que RESOLVE o `AuthenticatedRequestContext`
 * (o `sub` já veio validado do JWT) — não há um `context` anterior para checar contra.
 */
export class GetUserProfileBySubUseCase {
  constructor(private readonly userProfileRepository: UserProfileRepository) {}

  async execute(sub: string): Promise<UserProfile | null> {
    return this.userProfileRepository.findBySub(sub);
  }
}
