import { create } from 'zustand';
import { tournamentDb } from '../db/tournament-db';
import type { Tournament } from '../types/tournament';
import { withFriendlyError } from '../utils/storage';

interface TournamentState {
  tournaments: Tournament[];
  loading: boolean;
  registering: boolean;
  loadTournaments: () => Promise<void>;
  createTournament: (tournament: Tournament) => Promise<void>;
  registerTeam: (tournamentId: string, teamId: string) => Promise<void>;
}

export const useTournamentStore = create<TournamentState>((set, get) => ({
  tournaments: [],
  loading: false,
  registering: false,
  loadTournaments: async () => {
    set({ loading: true });
    try {
      const tournaments = await withFriendlyError(() => tournamentDb.getAll());
      set({ tournaments, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  createTournament: async (tournament) => {
    const saved = await withFriendlyError(() => tournamentDb.save(tournament));
    set((state) => ({ tournaments: [saved, ...state.tournaments] }));
  },
  registerTeam: async (tournamentId, teamId) => {
    const tournament = get().tournaments.find((item) => item.id === tournamentId);
    if (!tournament || tournament.teams.includes(teamId)) return;
    set({ registering: true });
    try {
      const saved = await withFriendlyError(() => tournamentDb.save({ ...tournament, teams: [...tournament.teams, teamId] }));
      set((state) => ({
        tournaments: state.tournaments.map((item) => (item.id === tournamentId ? saved : item)),
        registering: false,
      }));
    } catch {
      set({ registering: false });
    }
  },
}));
