import type { UserProfile } from '@/domain/entities/UserProfile';

export interface UserProfileRepository {
  findBySub(userId: string): Promise<UserProfile | null>;
  save(profile: UserProfile): Promise<void>;
}
