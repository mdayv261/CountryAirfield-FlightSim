import { validateAircraftData, type AircraftData } from './schema';
import airbike103 from './airbike103.json';
import decathlon8kcab from './decathlon8kcab.json';
import bensenB8M from './bensenB8M.json';

export type AircraftId = 'airbike103' | 'decathlon8kcab' | 'bensenB8M';

/** All aircraft, validated at load time. A bad data file throws here, before flight. */
export const AIRCRAFT: Readonly<Record<AircraftId, AircraftData>> = {
  airbike103: validateAircraftData(airbike103),
  decathlon8kcab: validateAircraftData(decathlon8kcab),
  bensenB8M: validateAircraftData(bensenB8M),
};

export type { AircraftData } from './schema';
