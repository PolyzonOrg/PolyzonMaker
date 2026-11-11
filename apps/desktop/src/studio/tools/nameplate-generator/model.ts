/**
 * «Таблички»: signs for doors and mailboxes, labels for
 * breaker panels, spools and machines. The model is shared with the
 * keychains (tag.ts); here are the presets and the mounts a plate offers.
 */
import * as m from '$msg/tools/nameplate-generator';
import { extend, PRESET_BASE, TAG_DEFAULTS, type TagParams, type TagPreset } from './tag';

/** A door sign: screws with countersunk heads, a frame, two lines. */
export const NAMEPLATE_DEFAULTS: TagParams = extend(TAG_DEFAULTS, {
	width: 120,
	height: 40,
	thickness: 3.2,
	radius: 3,
	get lines() {
		return [m.t_nameplate_generator_sample_line1(), m.t_nameplate_generator_sample_line2(), ''];
	},
	textHeight: 11,
	frame: true,
	mount: 'holes2',
	holeDiameter: 4,
	ringWidth: 3,
	countersink: true
});

// Labels and lines are messages: getters, read per render.
const presets: TagPreset[] = [
	{
		id: 'door',
		get label() {
			return m.t_nameplate_generator_preset_door();
		},
		get params() {
			return { ...NAMEPLATE_DEFAULTS };
		}
	},
	{
		id: 'mailbox',
		get label() {
			return m.t_nameplate_generator_preset_mailbox();
		},
		get params(): Partial<TagParams> {
			return {
				shape: 'rounded',
				width: 80,
				height: 26,
				radius: 3,
				lines: [
					m.t_nameplate_generator_preset_mailbox_line1(),
					m.t_nameplate_generator_preset_mailbox_line2(),
					''
				],
				textHeight: 9,
				adhesive: true
			};
		}
	},
	{
		id: 'breaker',
		get label() {
			return m.t_nameplate_generator_preset_breaker();
		},
		get params(): Partial<TagParams> {
			return {
				shape: 'rounded',
				width: 36,
				height: 12,
				radius: 1.5,
				thickness: 2,
				relief: 0.6,
				lines: [m.t_nameplate_generator_preset_breaker_line1(), '', ''],
				textHeight: 6,
				adhesive: true,
				adhesiveDepth: 0.4
			};
		}
	},
	{
		id: 'spool',
		get label() {
			return m.t_nameplate_generator_preset_spool();
		},
		get params(): Partial<TagParams> {
			return {
				shape: 'rounded',
				width: 60,
				height: 24,
				radius: 4,
				thickness: 2.4,
				lines: ['PETG', m.t_nameplate_generator_preset_spool_line2(), ''],
				textHeight: 9,
				mount: 'loop',
				placement: 'left',
				loopShape: 'flat'
			};
		}
	},
	{
		id: 'machine',
		get label() {
			return m.t_nameplate_generator_preset_machine();
		},
		get params(): Partial<TagParams> {
			return {
				shape: 'rounded',
				width: 100,
				height: 36,
				radius: 2,
				lines: [
					m.t_nameplate_generator_preset_machine_line1(),
					m.t_nameplate_generator_preset_machine_line2(),
					''
				],
				textHeight: 10,
				frame: true,
				mount: 'holes4',
				holeDiameter: 3.5,
				ringWidth: 2.5,
				countersink: true
			};
		}
	},
	{
		id: 'board',
		get label() {
			return m.t_nameplate_generator_preset_board();
		},
		get params(): Partial<TagParams> {
			return {
				shape: 'rounded',
				width: 70,
				height: 24,
				radius: 4,
				lines: [m.t_nameplate_generator_preset_board_line1(), '', ''],
				textHeight: 9,
				magnets: 2
			};
		}
	},
	{
		id: 'wifi',
		get label() {
			return m.t_nameplate_generator_preset_wifi();
		},
		get params(): Partial<TagParams> {
			return {
				shape: 'rounded',
				width: 90,
				height: 50,
				radius: 4,
				lines: ['Wi-Fi', m.t_nameplate_generator_preset_wifi_line2(), ''],
				textHeight: 10,
				qr: true,
				qrText: 'WIFI:T:WPA;S:Guest;P:12345678;;',
				qrSize: 40,
				frame: true,
				adhesive: true
			};
		}
	}
];

export const NAMEPLATE_PRESETS: readonly TagPreset[] = presets.map((p) => ({
	id: p.id,
	get label() {
		return p.label;
	},
	get params() {
		return { ...PRESET_BASE, ...p.params };
	}
}));
