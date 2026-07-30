import 'server-only';
import { IvsRealTimeService } from '@/infrastructure/aws/ivs/ivs-real-time-service';
import { getDocumentClient } from '@/infrastructure/aws/dynamodb/document-client';
import { CloudFrontSigningService } from '@/infrastructure/aws/cloudfront/cloudfront-signing-service';
import { DynamoDbClassGroupRepository } from '@/infrastructure/repositories/dynamodb-class-group-repository';
import { DynamoDbConnectionTicketRepository } from '@/infrastructure/repositories/dynamodb-connection-ticket-repository';
import { DynamoDbCourseRepository } from '@/infrastructure/repositories/dynamodb-course-repository';
import { DynamoDbEnrollmentRepository } from '@/infrastructure/repositories/dynamodb-enrollment-repository';
import { DynamoDbLiveParticipantRepository } from '@/infrastructure/repositories/dynamodb-live-participant-repository';
import { DynamoDbLiveSessionRepository } from '@/infrastructure/repositories/dynamodb-live-session-repository';
import { DynamoDbRecordingRepository } from '@/infrastructure/repositories/dynamodb-recording-repository';
import { DynamoDbUpcomingLiveRepository } from '@/infrastructure/repositories/dynamodb-upcoming-live-repository';
import { DynamoDbUserProfileRepository } from '@/infrastructure/repositories/dynamodb-user-profile-repository';
import { DynamoDbAttendanceRepository } from '@/infrastructure/repositories/dynamodb-attendance-repository';
import { DynamoDbQuestionRepository } from '@/infrastructure/repositories/dynamodb-question-repository';
import { DynamoDbPollRepository } from '@/infrastructure/repositories/dynamodb-poll-repository';
import { CancelLiveUseCase } from '@/application/use-cases/cancel-live';
import { CreateCourseUseCase } from '@/application/use-cases/create-course';
import { CreateClassGroupUseCase } from '@/application/use-cases/create-class-group';
import { UpdateClassGroupUseCase } from '@/application/use-cases/update-class-group';
import { FinishLiveUseCase } from '@/application/use-cases/finish-live';
import { GetRecordingPlaybackUseCase } from '@/application/use-cases/get-recording-playback';
import { GetUserProfileBySubUseCase } from '@/application/use-cases/get-user-profile-by-sub';
import { HideRecordingUseCase } from '@/application/use-cases/hide-recording';
import { IssueConnectionTicketUseCase } from '@/application/use-cases/issue-connection-ticket';
import { JoinLiveUseCase } from '@/application/use-cases/join-live';
import { ListCourseRecordingsUseCase } from '@/application/use-cases/list-course-recordings';
import { ListUpcomingLivesForTeacherUseCase } from '@/application/use-cases/list-upcoming-lives-for-teacher';
import { ListUpcomingLivesForStudentUseCase } from '@/application/use-cases/list-upcoming-lives-for-student';
import { ProvisionLiveStageUseCase } from '@/application/use-cases/provision-live-stage';
import { PromoteParticipantUseCase } from '@/application/use-cases/promote-participant';
import { DemoteParticipantUseCase } from '@/application/use-cases/demote-participant';
import { PublishRecordingUseCase } from '@/application/use-cases/publish-recording';
import { RefreshParticipantTokenUseCase } from '@/application/use-cases/refresh-participant-token';
import { ScheduleLiveUseCase } from '@/application/use-cases/schedule-live';
import { StartLiveUseCase } from '@/application/use-cases/start-live';
import { UpdateLiveUseCase } from '@/application/use-cases/update-live';
import { getEnv } from '@/shared/config/env';

function buildRepositories() {
  const documentClient = getDocumentClient();
  const tableName = getEnv().DYNAMODB_TABLE_NAME;

  return {
    liveSession: new DynamoDbLiveSessionRepository(documentClient, tableName),
    classGroup: new DynamoDbClassGroupRepository(documentClient, tableName),
    course: new DynamoDbCourseRepository(documentClient, tableName),
    enrollment: new DynamoDbEnrollmentRepository(documentClient, tableName),
    liveParticipant: new DynamoDbLiveParticipantRepository(documentClient, tableName),
    recording: new DynamoDbRecordingRepository(documentClient, tableName),
    userProfile: new DynamoDbUserProfileRepository(documentClient, tableName),
    connectionTicket: new DynamoDbConnectionTicketRepository(documentClient, tableName),
    upcomingLive: new DynamoDbUpcomingLiveRepository(documentClient, tableName),
    attendance: new DynamoDbAttendanceRepository(documentClient, tableName),
    question: new DynamoDbQuestionRepository(documentClient, tableName),
    poll: new DynamoDbPollRepository(documentClient, tableName),
  };
}

function buildUseCases(repos: ReturnType<typeof buildRepositories>) {
  const ivsRealTimeService = new IvsRealTimeService();
  const cloudFrontSigningService = new CloudFrontSigningService(
    getEnv().CLOUDFRONT_KEY_PAIR_ID,
    getEnv().CLOUDFRONT_PRIVATE_KEY_SECRET_ARN,
  );

  return {
    createCourse: new CreateCourseUseCase(repos.course),
    createClassGroup: new CreateClassGroupUseCase(repos.classGroup, repos.course),
    updateClassGroup: new UpdateClassGroupUseCase(repos.classGroup),
    getUserProfileBySub: new GetUserProfileBySubUseCase(repos.userProfile),
    listUpcomingLivesForTeacher: new ListUpcomingLivesForTeacherUseCase(
      repos.classGroup,
      repos.liveSession,
    ),
    listUpcomingLivesForStudent: new ListUpcomingLivesForStudentUseCase(
      repos.enrollment,
      repos.liveSession,
    ),
    scheduleLive: new ScheduleLiveUseCase(repos.liveSession, repos.classGroup),
    updateLive: new UpdateLiveUseCase(repos.liveSession),
    cancelLive: new CancelLiveUseCase(repos.liveSession, ivsRealTimeService),
    provisionLiveStage: new ProvisionLiveStageUseCase(repos.liveSession, ivsRealTimeService),
    startLive: new StartLiveUseCase(repos.liveSession),
    finishLive: new FinishLiveUseCase(repos.liveSession, ivsRealTimeService),
    joinLive: new JoinLiveUseCase(
      repos.liveSession,
      repos.enrollment,
      repos.liveParticipant,
      ivsRealTimeService,
      repos.connectionTicket,
      getEnv().IVS_PARTICIPANT_TOKEN_MAX_DURATION_MINUTES,
    ),
    issueConnectionTicket: new IssueConnectionTicketUseCase(
      repos.liveSession,
      repos.liveParticipant,
      repos.connectionTicket,
    ),
    refreshParticipantToken: new RefreshParticipantTokenUseCase(
      repos.liveSession,
      repos.liveParticipant,
      ivsRealTimeService,
      getEnv().IVS_PARTICIPANT_TOKEN_MAX_DURATION_MINUTES,
    ),
    promoteParticipant: new PromoteParticipantUseCase(
      repos.liveSession,
      repos.liveParticipant,
      ivsRealTimeService,
      getEnv().IVS_PARTICIPANT_TOKEN_MAX_DURATION_MINUTES,
    ),
    demoteParticipant: new DemoteParticipantUseCase(
      repos.liveSession,
      repos.liveParticipant,
      ivsRealTimeService,
    ),
    publishRecording: new PublishRecordingUseCase(repos.recording, repos.liveSession),
    hideRecording: new HideRecordingUseCase(repos.recording, repos.liveSession),
    listCourseRecordings: new ListCourseRecordingsUseCase(repos.recording, repos.course),
    getRecordingPlayback: new GetRecordingPlaybackUseCase(
      repos.recording,
      repos.liveSession,
      repos.enrollment,
      cloudFrontSigningService,
      getEnv().PLAYBACK_COOKIE_MAX_TTL_MINUTES,
    ),
  };
}

type Repositories = ReturnType<typeof buildRepositories>;
type UseCases = ReturnType<typeof buildUseCases>;

let cachedRepositories: Repositories | undefined;
let cachedUseCases: UseCases | undefined;

/**
 * Getters preguiçosos (`Proxy`), não construção no topo do módulo — o Next.js
 * avalia (importa) módulos de rota/página em BUILD TIME para "coletar dados da
 * página", antes de `cdk deploy` sequer existir; se a construção do container
 * rodasse no topo do módulo, `getEnv()` explodiria em build time (as env vars só
 * existem em runtime na Lambda, injetadas pelo CDK). Cada propriedade só é
 * construída no primeiro ACESSO de verdade, em runtime — `getEnv()`/
 * `getDocumentClient()` nunca rodam durante o build. Mesmo padrão de composição
 * módulo-level de `src/infrastructure/lambda-handlers/websocket/default.ts`, só
 * adiado até o primeiro uso (aquele arquivo não é importado pelo Next.js, então
 * não sofre desse problema).
 */
function lazy<T extends object>(build: () => T): T {
  return new Proxy({} as T, {
    get(_target, property, receiver) {
      return Reflect.get(build(), property, receiver);
    },
  });
}

export const repositories: Repositories = lazy(() => (cachedRepositories ??= buildRepositories()));
export const useCases: UseCases = lazy(
  () => (cachedUseCases ??= buildUseCases(repositories)),
);
