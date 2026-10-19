import type { AircraftData } from '../aircraft/schema';
import { AeroModel, emptyAeroOutput, type AeroOutput } from './aero';
import { PoweredAircraft, type AeroContext, type AeroSummary } from './PoweredAircraft';

export type { AeroContext, AeroSummary, FlightState, GMonitor, PilotControls } from './PoweredAircraft';

/**
 * A fixed-wing aircraft: the powered airframe plus a wing-and-tail aerodynamic model
 * (coefficient build-up, see aero.ts), with the slipstream feeding the tail.
 */
export class FixedWingAircraft extends PoweredAircraft {
  readonly aero: AeroModel;
  readonly aeroOut: AeroOutput = emptyAeroOutput();

  constructor(data: AircraftData, fuelFraction = 1) {
    super(data, fuelFraction);
    if (!data.aero) throw new Error(`${data.id} needs aero data to fly as a fixed-wing aircraft`);
    const g = data.geometry;
    this.aero = new AeroModel(data.aero, g.wingArea_m2!, g.span_m!, g.chord_m ?? g.wingArea_m2! / g.span_m!);
  }

  protected applyAirframeAero(c: AeroContext): AeroSummary {
    const b = this.body;
    const p = this.pilot;
    const a = this.aero.compute(
      {
        airVelocityBody: c.airVelocityBody,
        omegaBody: b.angularVelocity,
        density: c.density,
        controls: { elevator: p.elevator, aileron: p.aileron, rudder: this.rudderApplied },
        heightAboveGround: c.heightAgl,
        slipstreamPressure: c.slipstreamPressure,
      },
      this.aeroOut,
    );
    b.addForce(b.toWorld(a.force));
    b.addTorque(a.moment);
    return a;
  }

  protected swirlReference(): { area: number; length: number } {
    return { area: this.aero.area, length: this.aero.span };
  }
}
