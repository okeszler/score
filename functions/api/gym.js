import { json, handler } from '../../lib/http.js';
import { importGym } from '../../lib/gym.js';

// POST /api/gym -> heutigen (und gestrigen) Tag aus dem Gym-Tracker nachziehen; beim Öffnen von "Heute"
export const onRequestPost = handler(async ({ env }) => json(await importGym(env, { days: 1 })));
