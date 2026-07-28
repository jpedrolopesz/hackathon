import { assertRole, assertSameInstitution } from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { UserProfileRepository } from '@/application/ports/UserProfileRepository';
import type { UserProfile } from '@/domain/entities/UserProfile';
import type { Role } from '@/domain/value-objects/Role';

export interface CreateUserProfileInput {
  readonly userId: string;
  readonly institutionId: string;
  readonly role: Role;
  readonly name: string;
  readonly email: string;
}

/** Seção 5 do README: ADMIN gerencia professores e alunos. */
export class CreateUserProfileUseCase {
  constructor(private readonly userProfileRepository: UserProfileRepository) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: CreateUserProfileInput,
  ): Promise<UserProfile> {
    assertRole(context, ['ADMIN']);
    assertSameInstitution(context, input.institutionId);

    const now = new Date().toISOString();
    const profile: UserProfile = { ...input, createdAt: now, updatedAt: now };
    await this.userProfileRepository.save(profile);
    return profile;
  }
}
