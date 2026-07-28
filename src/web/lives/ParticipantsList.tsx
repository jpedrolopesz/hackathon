'use client';

import type { LiveParticipant } from '@/domain/entities/LiveParticipant';
import { demoteParticipantAction, promoteParticipantAction } from '@/web/actions/lives';
import { LiveActionButton } from './LiveActionButton';

export function ParticipantsList({
  liveId,
  participants,
}: {
  liveId: string;
  participants: readonly LiveParticipant[];
}) {
  if (participants.length === 0) {
    return (
      <p className="text-sm text-black/60 dark:text-white/60">
        Ninguém entrou nesta aula ainda.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-black/10 dark:divide-white/15">
      {participants.map((participant) => {
        const isPresenter = participant.capabilities.includes('PUBLISH');
        return (
          <li key={participant.liveParticipantId} className="flex items-center justify-between py-2">
            <span className="text-sm">
              {participant.role} — {isPresenter ? 'Apresentador' : 'Espectador'}
            </span>
            {isPresenter ? (
              <LiveActionButton
                label="Rebaixar"
                pendingLabel="Rebaixando…"
                variant="danger"
                action={demoteParticipantAction.bind(null, liveId, participant.liveParticipantId)}
              />
            ) : (
              <LiveActionButton
                label="Promover a apresentador"
                pendingLabel="Promovendo…"
                action={promoteParticipantAction.bind(null, liveId, participant.liveParticipantId)}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
