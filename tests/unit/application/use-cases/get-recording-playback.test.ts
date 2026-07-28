import { describe, expect, it } from 'vitest';
import { GetRecordingPlaybackUseCase } from '@/application/use-cases/get-recording-playback';
import type { LiveSession } from '@/domain/entities/LiveSession';
import type { Recording } from '@/domain/entities/Recording';
import type { Enrollment } from '@/domain/entities/Enrollment';
import { buildContext, FakeEnrollmentRepository } from './fixtures';
import { FakeLiveSessionRepository } from './live-fixtures';
import { FakeCloudFrontSigningService, FakeRecordingRepository } from './recording-fixtures';

const APP_DOMAIN = 'app.example.com';

function seedLive(repo: FakeLiveSessionRepository, overrides: Partial<LiveSession> = {}): LiveSession {
  const live: LiveSession = {
    liveId: 'live-1',
    classId: 'class-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    title: 'Aula 1',
    scheduledStartAt: '2026-01-01T14:00:00.000Z',
    status: 'ENDED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  repo.seed(live);
  return live;
}

function seedRecording(
  repo: FakeRecordingRepository,
  overrides: Partial<Recording> = {},
  withS3Paths = true,
): Recording {
  const recording: Recording = {
    recordingId: 'recording-1',
    liveId: 'live-1',
    courseId: 'course-1',
    institutionId: 'institution-1',
    stageArn: 'arn:aws:ivs:us-east-1:123456789012:stage/fake-stage',
    status: 'READY',
    startedAt: '2026-01-01T00:00:00.000Z',
    visibility: 'PUBLISHED',
    ...(withS3Paths
      ? {
          s3Prefix: 'course-1/live-1/composition',
          cloudFrontPath: 'course-1/live-1/composition/master.m3u8',
        }
      : {}),
    ...overrides,
  };
  repo.seed(recording);
  return recording;
}

function seedActiveEnrollment(repo: FakeEnrollmentRepository): Enrollment {
  const enrollment: Enrollment = {
    studentId: 'student-1',
    classId: 'class-1',
    courseId: 'course-1',
    institutionId: 'institution-1',
    courseName: 'Ciência da Computação',
    className: 'Aula 1',
    enrolledAt: '2026-01-01T00:00:00.000Z',
    status: 'ACTIVE',
  };
  repo.seed(enrollment);
  return enrollment;
}

function makeUseCase(maxTtlMinutes?: number) {
  const recordingRepository = new FakeRecordingRepository();
  const liveSessionRepository = new FakeLiveSessionRepository();
  const enrollmentRepository = new FakeEnrollmentRepository();
  const cloudFrontSigningService = new FakeCloudFrontSigningService();
  const useCase = new GetRecordingPlaybackUseCase(
    recordingRepository,
    liveSessionRepository,
    enrollmentRepository,
    cloudFrontSigningService,
    ...(maxTtlMinutes !== undefined ? [maxTtlMinutes] : []),
  );
  return {
    useCase,
    recordingRepository,
    liveSessionRepository,
    enrollmentRepository,
    cloudFrontSigningService,
  };
}

describe('GetRecordingPlaybackUseCase', () => {
  describe('autorização (seção 17 do README)', () => {
    it('rejects a student from another institution with a generic not-found (anti-enumeration)', async () => {
      const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository);

      await expect(
        useCase.execute(
          buildContext({ role: 'ALUNO', userId: 'student-1', institutionId: 'institution-2' }),
          { recordingId: 'recording-1', appDomainName: APP_DOMAIN },
        ),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    });

    it('rejects a student who is not enrolled in the class, same institution (anti-enumeration)', async () => {
      const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository);

      await expect(
        useCase.execute(buildContext({ role: 'ALUNO', userId: 'student-1' }), {
          recordingId: 'recording-1',
          appDomainName: APP_DOMAIN,
        }),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    });

    it('rejects a professor of another class in the same institution', async () => {
      const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository);

      await expect(
        useCase.execute(buildContext({ role: 'PROFESSOR', userId: 'teacher-2' }), {
          recordingId: 'recording-1',
          appDomainName: APP_DOMAIN,
        }),
      ).rejects.toMatchObject({ code: 'CLASS_NOT_OWNED' });
    });

    it('rejects a recording that is not READY yet', async () => {
      const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository, { status: 'PROCESSING', visibility: 'DRAFT' });

      await expect(
        useCase.execute(buildContext({ role: 'ADMIN' }), {
          recordingId: 'recording-1',
          appDomainName: APP_DOMAIN,
        }),
      ).rejects.toMatchObject({ code: 'RECORDING_NOT_AVAILABLE' });
    });

    it('rejects a READY recording that the professor has not published yet', async () => {
      const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository, { visibility: 'DRAFT' });

      await expect(
        useCase.execute(buildContext({ role: 'ADMIN' }), {
          recordingId: 'recording-1',
          appDomainName: APP_DOMAIN,
        }),
      ).rejects.toMatchObject({ code: 'RECORDING_NOT_AVAILABLE' });
    });

    it('rejects an enrolled student when the recording is HIDDEN', async () => {
      const { useCase, recordingRepository, liveSessionRepository, enrollmentRepository } =
        makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository, { status: 'HIDDEN' });
      seedActiveEnrollment(enrollmentRepository);

      await expect(
        useCase.execute(
          buildContext({ role: 'ALUNO', userId: 'student-1', institutionId: 'institution-1' }),
          { recordingId: 'recording-1', appDomainName: APP_DOMAIN },
        ),
      ).rejects.toMatchObject({ code: 'RECORDING_NOT_AVAILABLE' });
    });

    it('allows the owning professor to view a HIDDEN recording (review, not a public replay)', async () => {
      const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository, { status: 'HIDDEN' });

      const result = await useCase.execute(
        buildContext({ role: 'PROFESSOR', userId: 'teacher-1' }),
        { recordingId: 'recording-1', appDomainName: APP_DOMAIN },
      );

      expect(result.manifestUrl).toBeDefined();
    });

    it('allows ADMIN to view a HIDDEN recording', async () => {
      const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository, { status: 'HIDDEN' });

      await expect(
        useCase.execute(buildContext({ role: 'ADMIN' }), {
          recordingId: 'recording-1',
          appDomainName: APP_DOMAIN,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('cookies assinados, escopados ao prefixo, servidos sob /media/* do domínio do painel (first-party)', () => {
    it('signs cookies with a policy Resource wildcard scoped to the recording s3Prefix under /media/*, never the whole domain', async () => {
      const {
        useCase,
        recordingRepository,
        liveSessionRepository,
        enrollmentRepository,
        cloudFrontSigningService,
      } = makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository);
      seedActiveEnrollment(enrollmentRepository);

      const result = await useCase.execute(
        buildContext({ role: 'ALUNO', userId: 'student-1', institutionId: 'institution-1' }),
        { recordingId: 'recording-1', appDomainName: APP_DOMAIN },
      );

      expect(cloudFrontSigningService.calls).toHaveLength(1);
      expect(cloudFrontSigningService.calls[0]?.resourceUrlPattern).toBe(
        `https://${APP_DOMAIN}/media/course-1/live-1/composition/*`,
      );
      expect(result.manifestUrl).toBe(
        `https://${APP_DOMAIN}/media/course-1/live-1/composition/master.m3u8`,
      );
      expect(result.cookiePath).toBe('/media/course-1/live-1/composition/');
      expect(result.cookies).toEqual({
        policy: expect.any(String),
        signature: expect.any(String),
        keyPairId: expect.any(String),
      });
    });

    it('builds the URL/policy from the appDomainName given per call, not a fixed value (works for any domain the request arrived on)', async () => {
      const { useCase, recordingRepository, liveSessionRepository, cloudFrontSigningService } =
        makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository);

      const result = await useCase.execute(buildContext({ role: 'ADMIN' }), {
        recordingId: 'recording-1',
        appDomainName: 'd111111abcdef8.cloudfront.net',
      });

      expect(result.manifestUrl).toBe(
        'https://d111111abcdef8.cloudfront.net/media/course-1/live-1/composition/master.m3u8',
      );
      expect(cloudFrontSigningService.calls[0]?.resourceUrlPattern).toContain(
        'd111111abcdef8.cloudfront.net/media/',
      );
    });

    it('rejects a READY/PUBLISHED recording still missing s3Prefix/cloudFrontPath (not fully processed)', async () => {
      const { useCase, recordingRepository, liveSessionRepository } = makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository, {}, false);

      await expect(
        useCase.execute(buildContext({ role: 'ADMIN' }), {
          recordingId: 'recording-1',
          appDomainName: APP_DOMAIN,
        }),
      ).rejects.toMatchObject({ code: 'RECORDING_NOT_AVAILABLE' });
    });
  });

  describe('TTL do cookie — duração da gravação + margem, com piso e teto (não mais fixo)', () => {
    it('uses the 15min floor for a very short recording (duration + margin would be less)', async () => {
      const { useCase, recordingRepository, liveSessionRepository, cloudFrontSigningService } =
        makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository, { durationSeconds: 60 }); // 1 minuto

      const before = Date.now();
      await useCase.execute(buildContext({ role: 'ADMIN' }), {
        recordingId: 'recording-1',
        appDomainName: APP_DOMAIN,
      });

      const expiresAt = cloudFrontSigningService.calls[0]?.expiresAt.getTime() ?? 0;
      // 1min + 10min de margem = 11min < piso de 15min — o piso vence.
      expect(expiresAt).toBeGreaterThanOrEqual(before + 15 * 60_000 - 1000);
      expect(expiresAt).toBeLessThan(before + 16 * 60_000);
    });

    it('falls back to the 15min floor when there is no durationSeconds at all', async () => {
      const { useCase, recordingRepository, liveSessionRepository, cloudFrontSigningService } =
        makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository); // sem durationSeconds

      const before = Date.now();
      await useCase.execute(buildContext({ role: 'ADMIN' }), {
        recordingId: 'recording-1',
        appDomainName: APP_DOMAIN,
      });

      const expiresAt = cloudFrontSigningService.calls[0]?.expiresAt.getTime() ?? 0;
      // durationSeconds ausente conta como 0 + 10min de margem = 10min < piso de 15min.
      expect(expiresAt).toBeGreaterThanOrEqual(before + 15 * 60_000 - 1000);
      expect(expiresAt).toBeLessThan(before + 16 * 60_000);
    });

    it('covers a long (2h) recording with margin — the TTL must outlast the recording duration', async () => {
      const { useCase, recordingRepository, liveSessionRepository, cloudFrontSigningService } =
        makeUseCase();
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository, { durationSeconds: 2 * 60 * 60 }); // 2h

      const before = Date.now();
      await useCase.execute(buildContext({ role: 'ADMIN' }), {
        recordingId: 'recording-1',
        appDomainName: APP_DOMAIN,
      });

      const expiresAt = cloudFrontSigningService.calls[0]?.expiresAt.getTime() ?? 0;
      // 2h + 10min de margem = 2h10, bem além do fixo de 15min do desenho anterior —
      // o problema original era exatamente uma gravação de 2h expirar aos 15min.
      expect(expiresAt).toBeGreaterThanOrEqual(before + 130 * 60_000 - 1000);
    });

    it('caps the TTL at maxTtlMinutes even for a very long recording', async () => {
      const { useCase, recordingRepository, liveSessionRepository, cloudFrontSigningService } =
        makeUseCase(60); // teto de 1h para este teste
      seedLive(liveSessionRepository);
      seedRecording(recordingRepository, { durationSeconds: 5 * 60 * 60 }); // 5h

      const before = Date.now();
      await useCase.execute(buildContext({ role: 'ADMIN' }), {
        recordingId: 'recording-1',
        appDomainName: APP_DOMAIN,
      });

      const expiresAt = cloudFrontSigningService.calls[0]?.expiresAt.getTime() ?? 0;
      expect(expiresAt).toBeLessThanOrEqual(before + 60 * 60_000 + 1000);
    });
  });
});
