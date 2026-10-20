import type { SoundData } from '../aircraft/schema';
import type { PoweredAircraft } from '../physics/PoweredAircraft';
import { CABIN, engineSound, rotorSound, stallHorn, windSound } from './soundModel';

/** Time constant for smoothing every level and pitch change, s (no clicks or zipper noise). */
const SMOOTH_S = 0.04;
/** Horn on/off is quicker, like a real reed horn starting and stopping. */
const HORN_SMOOTH_S = 0.015;
/** White-noise buffer length, s (looped: long enough not to hear the repeat). */
const NOISE_SECONDS = 3;
/** Wind roar filter sharpness, rotor swish filter sharpness. */
const WIND_Q = 0.7;
const ROTOR_Q = 1.4;
const NOISE_Q = 1.2;
/** Prop buzz is a low, rounded tone: low-pass its sawtooth here, Hz. */
const PROP_CUTOFF_HZ = 600;
/** Mix level of each source into the bus (before its own 0..1 level). */
/** The throb is a deep, rounded beat: low-pass its triangle wave here, Hz. */
const THROB_CUTOFF_HZ = 250;
const MIX = { throb: 0.45, engine: 0.5, noise: 0.35, belt: 0.15, prop: 0.35, wind: 0.35, rotor: 0.45, horn: 0.25 };
/** Open-air bandwidth (no cabin), Hz. */
const OPEN_CUTOFF_HZ = 18000;

/** Where the listener is this frame. */
export interface Listener {
  /** In the cockpit (wind and horn heard, cabin muffling applies) or outside. */
  inCockpit: boolean;
  /** Distance attenuation 0..1 and Doppler pitch factor (1 in the cockpit). */
  gain: number;
  doppler: number;
}

/**
 * Synthesised aircraft sound with the Web Audio API. Built from oscillators and filtered
 * noise, driven every frame by soundModel.ts:
 *  - engine: a periodic wave at the firing frequency with the engine's harmonic mix, through
 *    a low-pass that opens with throttle; a throb at crankshaft rate (multi-cylinder engines);
 *    plus exhaust noise pulsed at the firing rate;
 *  - belt whine (belt-drive engines), propeller blade-passing buzz;
 *  - wind roar (band-passed noise rising with airspeed), rotor swish (noise beating at the
 *    blade-passing rate), stall horn.
 * The audio context starts on the first key press or click (browsers require a gesture).
 */
export class SoundSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private cabin!: BiquadFilterNode;
  private noiseBuffer!: AudioBuffer;
  private volume = 0.8;
  private muted = false;
  private snd: SoundData | null = null;
  private engineOsc!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private noiseBand!: BiquadFilterNode;
  private noiseGain!: GainNode;
  private pulseOsc!: OscillatorNode;
  private pulseDepth!: GainNode;
  private throbOsc!: OscillatorNode;
  private throbGain!: GainNode;
  private beltOsc!: OscillatorNode;
  private beltGain!: GainNode;
  private propOsc!: OscillatorNode;
  private propGain!: GainNode;
  private windBand!: BiquadFilterNode;
  private windGain!: GainNode;
  private rotorBand!: BiquadFilterNode;
  private rotorGain!: GainNode;
  private rotorLfo!: OscillatorNode;
  private rotorDepth!: GainNode;
  private hornOsc!: OscillatorNode;
  private hornGain!: GainNode;

  /** Call from a user gesture (key press, click): creates or resumes the audio context. */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    if (!this.ctx) this.build(new AudioContext());
    if (this.ctx!.state === 'suspended') void this.ctx!.resume();
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : volume, this.ctx.currentTime, SMOOTH_S);
  }

  /** Pause (silence) or resume with the simulation. */
  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    if (paused && this.ctx.state === 'running') void this.ctx.suspend();
    else if (!paused && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Switch to an aircraft's sound (its engine tone colour). */
  setAircraft(snd: SoundData | undefined): void {
    this.snd = snd ?? null;
    if (this.ctx && this.snd) this.engineOsc.setPeriodicWave(this.wave(this.snd.engine.harmonics));
  }

  update(ac: PoweredAircraft, listener: Listener): void {
    const ctx = this.ctx;
    const snd = this.snd;
    if (!ctx || !snd) return;
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number, tau = SMOOTH_S) => p.setTargetAtTime(Number.isFinite(v) ? v : 0, t, tau);
    const f = listener.doppler;

    const e = engineSound(ac, snd);
    set(this.engineOsc.frequency, Math.max(1, e.firingHz) * f);
    set(this.engineFilter.frequency, e.cutoffHz * f);
    set(this.engineGain.gain, MIX.engine * e.level);
    set(this.noiseBand.frequency, e.noiseHz * f);
    // The exhaust noise pulses with each firing: a steady part plus a part driven by the pulse oscillator.
    const noise = MIX.noise * e.noiseLevel;
    set(this.noiseGain.gain, noise * (1 - e.pulse / 2));
    set(this.pulseDepth.gain, (noise * e.pulse) / 2);
    set(this.pulseOsc.frequency, Math.max(1, e.firingHz) * f);
    set(this.throbOsc.frequency, Math.max(1, e.throbHz) * f);
    set(this.throbGain.gain, MIX.throb * e.throbLevel);
    set(this.beltOsc.frequency, Math.max(1, e.beltHz) * f);
    set(this.beltGain.gain, MIX.belt * e.beltLevel);
    set(this.propOsc.frequency, Math.max(1, e.propHz) * f);
    set(this.propGain.gain, MIX.prop * e.propLevel);

    const r = rotorSound(ac, snd);
    set(this.rotorBand.frequency, Math.max(20, r.bandHz) * f);
    set(this.rotorLfo.frequency, Math.max(0.1, r.swishHz) * f);
    // Swish: the noise rises and falls each time a blade passes (mostly modulated).
    set(this.rotorGain.gain, MIX.rotor * r.level * 0.4);
    set(this.rotorDepth.gain, MIX.rotor * r.level * 0.6);

    // Heard from the cockpit only: the airflow round the pilot, and the cockpit horn.
    const w = windSound(ac.state.ias, snd);
    set(this.windBand.frequency, w.centreHz);
    set(this.windGain.gain, listener.inCockpit ? MIX.wind * w.level : 0);
    const h = stallHorn(ac, snd);
    set(this.hornOsc.frequency, Math.max(1, h.frequencyHz));
    set(this.hornGain.gain, listener.inCockpit && h.on ? MIX.horn * h.level : 0, HORN_SMOOTH_S);

    set(this.bus.gain, listener.gain);
    const enclosed = listener.inCockpit && snd.cockpit === 'enclosed';
    set(this.cabin.frequency, enclosed ? CABIN.engineCutoffHz : OPEN_CUTOFF_HZ);
  }

  private wave(harmonics: number[]): PeriodicWave {
    const real = new Float32Array(harmonics.length + 1);
    const imag = new Float32Array(harmonics.length + 1);
    harmonics.forEach((a, i) => (imag[i + 1] = a));
    return this.ctx!.createPeriodicWave(real, imag);
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp);
    this.cabin = ctx.createBiquadFilter();
    this.cabin.type = 'lowpass';
    this.cabin.frequency.value = OPEN_CUTOFF_HZ;
    this.cabin.connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.cabin);

    this.noiseBuffer = ctx.createBuffer(1, Math.round(NOISE_SECONDS * ctx.sampleRate), ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = () => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      src.loopStart = Math.random() * (NOISE_SECONDS - 1); // decorrelate the noise voices
      src.start();
      return src;
    };
    // A gain feeding a node, or modulating a parameter (an LFO's depth).
    const gain = (to: AudioNode | AudioParam, v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      if (to instanceof AudioParam) g.connect(to);
      else g.connect(to);
      return g;
    };
    const filter = (type: BiquadFilterType, to: AudioNode, hz: number, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      f.Q.value = q;
      f.connect(to);
      return f;
    };
    const osc = (type: OscillatorType, to: AudioNode, hz: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      o.connect(to);
      o.start();
      return o;
    };

    // Engine note.
    this.engineGain = gain(this.bus);
    this.engineFilter = filter('lowpass', this.engineGain, 2000);
    this.engineOsc = osc('sine', this.engineFilter, 50);
    // Exhaust noise, pulsed at the firing rate.
    this.noiseGain = gain(this.bus);
    this.noiseBand = filter('bandpass', this.noiseGain, 1000, NOISE_Q);
    noise().connect(this.noiseBand);
    this.pulseDepth = gain(this.noiseGain.gain);
    this.pulseOsc = osc('sine', this.pulseDepth, 50);
    // Crankshaft-rate throb (multi-cylinder engines).
    this.throbGain = gain(this.bus);
    this.throbOsc = osc('triangle', filter('lowpass', this.throbGain, THROB_CUTOFF_HZ), 25);
    // Belt whine and propeller buzz.
    this.beltGain = gain(this.bus);
    this.beltOsc = osc('sine', this.beltGain, 1000);
    this.propGain = gain(this.bus);
    this.propOsc = osc('sawtooth', filter('lowpass', this.propGain, PROP_CUTOFF_HZ), 50);
    // Rotor swish: band-passed noise whose level beats at the blade-passing rate.
    this.rotorGain = gain(this.bus);
    this.rotorBand = filter('bandpass', this.rotorGain, 650, ROTOR_Q);
    noise().connect(this.rotorBand);
    this.rotorDepth = gain(this.rotorGain.gain);
    this.rotorLfo = osc('sine', this.rotorDepth, 10);
    // Listener-side sounds (not attenuated by distance): wind round the pilot, cockpit horn.
    this.windGain = gain(this.master);
    this.windBand = filter('bandpass', this.windGain, 400, WIND_Q);
    noise().connect(this.windBand);
    this.hornGain = gain(this.master);
    this.hornOsc = osc('square', filter('bandpass', this.hornGain, 1250, 2), 1250);

    if (this.snd) this.engineOsc.setPeriodicWave(this.wave(this.snd.engine.harmonics));
  }
}
