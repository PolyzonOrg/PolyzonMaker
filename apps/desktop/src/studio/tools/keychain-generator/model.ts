/**
 * «Брелки»: keychains, pet tags, wardrobe numbers, luggage tags.
 * Same model as the nameplates (nameplate-generator/tag.ts) with its own
 * presets; the loop sits outside the part by default.
 */
import {
	PRESET_BASE,
	TAG_DEFAULTS,
	type TagParams,
	type TagPreset
} from '../nameplate-generator/tag';
import * as m from '$msg/tools/keychain-generator';

/** A copy that keeps getters as getters: a default sample text follows the page language. */
export const KEYCHAIN_DEFAULTS: TagParams = Object.defineProperties(
	{} as TagParams,
	Object.getOwnPropertyDescriptors(TAG_DEFAULTS)
);

/** Label and sample texts are read per page, in its language (never once at import). */
function preset(id: string, label: () => string, params: () => Partial<TagParams>): TagPreset {
	return {
		id,
		get label() {
			return label();
		},
		get params() {
			return { ...PRESET_BASE, ...params() };
		}
	};
}

export const KEYCHAIN_PRESETS: readonly TagPreset[] = [
	preset('keys', m.t_keychain_generator_preset_keys, () => ({ ...KEYCHAIN_DEFAULTS })),
	preset('dog', m.t_keychain_generator_preset_dog, () => ({
		shape: 'dogtag',
		width: 66,
		height: 36,
		lines: [m.t_keychain_generator_sample_pet(), m.t_keychain_generator_sample_dog_phone(), ''],
		textHeight: 8,
		mount: 'loop',
		placement: 'top'
	})),
	preset('bone', m.t_keychain_generator_preset_bone, () => ({
		shape: 'bone',
		width: 60,
		height: 26,
		lines: [m.t_keychain_generator_sample_pet(), '', ''],
		textHeight: 8,
		mount: 'loop',
		placement: 'left'
	})),
	preset('cat', m.t_keychain_generator_preset_cat, () => ({
		shape: 'circle',
		width: 28,
		thickness: 2.4,
		relief: 0.6,
		lines: [m.t_keychain_generator_sample_cat(), '', ''],
		textHeight: 5,
		mount: 'loop',
		placement: 'top',
		holeDiameter: 3.5,
		ringWidth: 2
	})),
	preset('heart', m.t_keychain_generator_preset_heart, () => ({
		shape: 'heart',
		width: 46,
		height: 42,
		lines: [m.t_keychain_generator_sample_heart(), '', ''],
		textHeight: 7,
		mount: 'loop',
		placement: 'top-left'
	})),
	preset('wardrobe', m.t_keychain_generator_preset_wardrobe, () => ({
		shape: 'circle',
		width: 38,
		lines: ['27', '', ''],
		textHeight: 16,
		frame: true,
		mount: 'loop',
		placement: 'top',
		loopShape: 'flat',
		holeDiameter: 6
	})),
	preset('luggage', m.t_keychain_generator_preset_luggage, () => ({
		shape: 'dogtag',
		width: 72,
		height: 40,
		lines: [
			m.t_keychain_generator_sample_luggage_name(),
			m.t_keychain_generator_sample_luggage_phone(),
			''
		],
		textHeight: 8,
		mount: 'loop',
		placement: 'top',
		holeDiameter: 6,
		ringWidth: 3
	})),
	preset('name', m.t_keychain_generator_preset_name, () => ({
		base: 'contour',
		lines: [m.t_keychain_generator_sample_name(), '', ''],
		textHeight: 12,
		contourPad: 2.5,
		mount: 'loop',
		placement: 'left'
	})),
	preset('qr', m.t_keychain_generator_preset_qr, () => ({
		shape: 'rounded',
		width: 64,
		height: 30,
		radius: 4,
		lines: [m.t_keychain_generator_sample_qr(), '', ''],
		textHeight: 6,
		qr: true,
		qrSize: 26,
		mount: 'loop',
		placement: 'left'
	}))
];
