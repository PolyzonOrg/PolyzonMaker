/**
 * The free tools of the studio (/workspace/tools): parametric generators,
 * utilities for an uploaded model and print utilities. Everything runs in the
 * browser — no neural network, no tokens. One entry per tool; the catalog
 * page, the tool route and the navigation read this list.
 */
import type { Icon as LucideIcon } from 'lucide-svelte';
import * as m from '$msg/tools/catalog';
import {
	Accessibility,
	Activity,
	Amphora,
	Anchor,
	Aperture,
	ArchiveRestore,
	ArrowRightLeft,
	Baby,
	Bandage,
	Battery,
	Beaker,
	Blocks,
	Bolt,
	Bookmark,
	Boxes,
	Cable,
	Cake,
	Calculator,
	CaseUpper,
	CircleDashed,
	CircleDot,
	CircleGauge,
	Coffee,
	Cog,
	Cookie,
	CornerDownRight,
	Cpu,
	Cylinder,
	Dices,
	Disc,
	Disc3,
	DoorOpen,
	Drill,
	Droplets,
	EthernetPort,
	Fan,
	Feather,
	FileCode,
	FilePen,
	FlaskConical,
	Gauge,
	Gift,
	Grid2x2,
	Grid3x3,
	GripHorizontal,
	Hexagon,
	Images,
	Keyboard,
	KeyRound,
	Lamp,
	LampCeiling,
	LandPlot,
	Layers,
	LayoutGrid,
	LayoutPanelTop,
	LifeBuoy,
	Lightbulb,
	Link,
	Link2,
	LoaderPinwheel,
	Medal,
	Nfc,
	Package,
	Paintbrush,
	PaintBucket,
	Palette,
	Paperclip,
	Pencil,
	Puzzle,
	QrCode,
	Ruler,
	Scaling,
	ScanEye,
	Scissors,
	Server,
	ShoppingBasket,
	ShowerHead,
	Sigma,
	Smartphone,
	Snowflake,
	SprayCan,
	Sprout,
	SquareSquare,
	SquareStack,
	Stamp,
	SwatchBook,
	Tag,
	Tags,
	Target,
	Thermometer,
	TreePine,
	Type,
	TypeOutline,
	Ungroup,
	Unplug,
	Waves,
	Wind
} from 'lucide-svelte';

export type ToolCategory = 'make' | 'mesh' | 'print';

/**
 * How the tool computes its result. OpenSCAD (in the browser) is too slow
 * for a form that rebuilds on every change; tools use it only to draw
 * letters and SVG outlines, and hand an equivalent program to the editor.
 */
export type ToolEngine =
	/** Geometry built directly in JS. */
	| 'mesh'
	/** Solids, booleans and offsets in manifold-3d (WASM, in a worker). */
	| 'manifold'
	/** G-code generated or read in JS. */
	| 'gcode'
	/** Numbers only: forms and tables, no 3D. */
	| 'calc';

export interface ToolInfo {
	slug: string;
	title: string;
	/** One sentence for the catalog card: what you put in, what you get. */
	description: string;
	category: ToolCategory;
	engine: ToolEngine;
	icon: typeof LucideIcon;
}

/**
 * Titles and leads are messages in the language being rendered: read them while
 * rendering (getters), never into a module-level constant.
 */
export const TOOL_CATEGORIES: readonly { id: ToolCategory; title: string; lead: string }[] = [
	{
		id: 'make',
		get title() {
			return m.tcat_cat_make_title();
		},
		get lead() {
			return m.tcat_cat_make_lead();
		}
	},
	{
		id: 'mesh',
		get title() {
			return m.tcat_cat_mesh_title();
		},
		get lead() {
			return m.tcat_cat_mesh_lead();
		}
	},
	{
		id: 'print',
		get title() {
			return m.tcat_cat_print_title();
		},
		get lead() {
			return m.tcat_cat_print_lead();
		}
	}
];

/** A tool as listed below: its title and description are the messages themselves. */
type Entry = Omit<ToolInfo, 'title' | 'description'> & {
	title: () => string;
	description: () => string;
};

const ENTRIES: readonly Entry[] = [
	// Generators
	{
		slug: 'box-generator',
		title: m.tcat_box_generator_title,
		description: m.tcat_box_generator_description,
		category: 'make',
		engine: 'manifold',
		icon: Grid3x3
	},
	{
		slug: 'box-master',
		title: m.tcat_box_master_title,
		description: m.tcat_box_master_description,
		category: 'make',
		engine: 'manifold',
		icon: Package
	},
	{
		slug: 'drawer-organizer',
		title: m.tcat_drawer_organizer_title,
		description: m.tcat_drawer_organizer_description,
		category: 'make',
		engine: 'manifold',
		icon: LayoutGrid
	},
	{
		slug: 'brick-generator',
		title: m.tcat_brick_generator_title,
		description: m.tcat_brick_generator_description,
		category: 'make',
		engine: 'manifold',
		icon: Blocks
	},
	{
		slug: 'vase-generator',
		title: m.tcat_vase_generator_title,
		description: m.tcat_vase_generator_description,
		category: 'make',
		engine: 'mesh',
		icon: Amphora
	},
	{
		slug: 'hook-generator',
		title: m.tcat_hook_generator_title,
		description: m.tcat_hook_generator_description,
		category: 'make',
		engine: 'manifold',
		icon: Anchor
	},
	{
		slug: 'nameplate-generator',
		title: m.tcat_nameplate_generator_title,
		description: m.tcat_nameplate_generator_description,
		category: 'make',
		engine: 'manifold',
		icon: Tag
	},
	{
		slug: 'braille-sign',
		title: m.tcat_braille_sign_title,
		description: m.tcat_braille_sign_description,
		category: 'make',
		engine: 'manifold',
		icon: Accessibility
	},
	{
		slug: 'cable-tag',
		title: m.tcat_cable_tag_title,
		description: m.tcat_cable_tag_description,
		category: 'make',
		engine: 'manifold',
		icon: Tags
	},
	{
		slug: 'nfc-tag',
		title: m.tcat_nfc_tag_title,
		description: m.tcat_nfc_tag_description,
		category: 'make',
		engine: 'manifold',
		icon: Nfc
	},
	{
		slug: 'photo-frame',
		title: m.tcat_photo_frame_title,
		description: m.tcat_photo_frame_description,
		category: 'make',
		engine: 'manifold',
		icon: Images
	},
	{
		slug: 'keychain-generator',
		title: m.tcat_keychain_generator_title,
		description: m.tcat_keychain_generator_description,
		category: 'make',
		engine: 'manifold',
		icon: KeyRound
	},
	{
		slug: 'qr-plate-generator',
		title: m.tcat_qr_plate_generator_title,
		description: m.tcat_qr_plate_generator_description,
		category: 'make',
		engine: 'manifold',
		icon: QrCode
	},
	{
		slug: 'stencil-generator',
		title: m.tcat_stencil_generator_title,
		description: m.tcat_stencil_generator_description,
		category: 'make',
		engine: 'manifold',
		icon: SprayCan
	},
	{
		slug: 'drill-template-generator',
		title: m.tcat_drill_template_generator_title,
		description: m.tcat_drill_template_generator_description,
		category: 'make',
		engine: 'manifold',
		icon: Drill
	},
	{
		slug: 'cookie-cutter',
		title: m.tcat_cookie_cutter_title,
		description: m.tcat_cookie_cutter_description,
		category: 'make',
		engine: 'manifold',
		icon: Cookie
	},
	{
		slug: 'text-flip',
		title: m.tcat_text_flip_title,
		description: m.tcat_text_flip_description,
		category: 'make',
		engine: 'manifold',
		icon: Type
	},
	{
		slug: 'sign-generator',
		title: m.tcat_sign_generator_title,
		description: m.tcat_sign_generator_description,
		category: 'make',
		engine: 'manifold',
		icon: Lightbulb
	},
	{
		slug: 'lithophane-generator',
		title: m.tcat_lithophane_generator_title,
		description: m.tcat_lithophane_generator_description,
		category: 'make',
		engine: 'mesh',
		icon: Lamp
	},
	{
		slug: 'colour-logo',
		title: m.tcat_colour_logo_title,
		description: m.tcat_colour_logo_description,
		category: 'make',
		engine: 'manifold',
		icon: Palette
	},
	{
		slug: 'pixel-mosaic',
		title: m.tcat_pixel_mosaic_title,
		description: m.tcat_pixel_mosaic_description,
		category: 'make',
		engine: 'manifold',
		icon: Grid2x2
	},
	{
		slug: 'filament-painting',
		title: m.tcat_filament_painting_title,
		description: m.tcat_filament_painting_description,
		category: 'make',
		engine: 'mesh',
		icon: Paintbrush
	},
	{
		slug: 'light-box',
		title: m.tcat_light_box_title,
		description: m.tcat_light_box_description,
		category: 'make',
		engine: 'manifold',
		icon: Layers
	},
	{
		slug: 'bolt-generator',
		title: m.tcat_bolt_generator_title,
		description: m.tcat_bolt_generator_description,
		category: 'make',
		engine: 'manifold',
		icon: Bolt
	},
	{
		slug: 'washers',
		title: m.tcat_washers_title,
		description: m.tcat_washers_description,
		category: 'make',
		engine: 'manifold',
		icon: Target
	},
	{
		slug: 'bolt-gauge',
		title: m.tcat_bolt_gauge_title,
		description: m.tcat_bolt_gauge_description,
		category: 'make',
		engine: 'manifold',
		icon: Gauge
	},
	{
		slug: 'flat-spring',
		title: m.tcat_flat_spring_title,
		description: m.tcat_flat_spring_description,
		category: 'make',
		engine: 'manifold',
		icon: Activity
	},
	{
		slug: 'jar-generator',
		title: m.tcat_jar_generator_title,
		description: m.tcat_jar_generator_description,
		category: 'make',
		engine: 'manifold',
		icon: Cylinder
	},
	{
		slug: 'knob-generator',
		title: m.tcat_knob_generator_title,
		description: m.tcat_knob_generator_description,
		category: 'make',
		engine: 'manifold',
		icon: CircleGauge
	},
	{
		slug: 'gear-generator',
		title: m.tcat_gear_generator_title,
		description: m.tcat_gear_generator_description,
		category: 'make',
		engine: 'manifold',
		icon: Cog
	},
	{
		slug: 'bearing',
		title: m.tcat_bearing_title,
		description: m.tcat_bearing_description,
		category: 'make',
		engine: 'manifold',
		icon: LifeBuoy
	},
	{
		slug: 'pulley',
		title: m.tcat_pulley_title,
		description: m.tcat_pulley_description,
		category: 'make',
		engine: 'manifold',
		icon: Disc3
	},
	{
		slug: 'hose-adapter',
		title: m.tcat_hose_adapter_title,
		description: m.tcat_hose_adapter_description,
		category: 'make',
		engine: 'manifold',
		icon: Droplets
	},
	{
		slug: 'vacuum-nozzle',
		title: m.tcat_vacuum_nozzle_title,
		description: m.tcat_vacuum_nozzle_description,
		category: 'make',
		engine: 'manifold',
		icon: Wind
	},
	{
		slug: 'cable-clip',
		title: m.tcat_cable_clip_title,
		description: m.tcat_cable_clip_description,
		category: 'make',
		engine: 'manifold',
		icon: Cable
	},
	{
		slug: 'cable-raceway',
		title: m.tcat_cable_raceway_title,
		description: m.tcat_cable_raceway_description,
		category: 'make',
		engine: 'manifold',
		icon: Unplug
	},
	{
		slug: 'desk-grommet',
		title: m.tcat_desk_grommet_title,
		description: m.tcat_desk_grommet_description,
		category: 'make',
		engine: 'manifold',
		icon: CircleDot
	},
	{
		slug: 'fan-grille',
		title: m.tcat_fan_grille_title,
		description: m.tcat_fan_grille_description,
		category: 'make',
		engine: 'manifold',
		icon: Fan
	},
	{
		slug: 'impeller',
		title: m.tcat_impeller_title,
		description: m.tcat_impeller_description,
		category: 'make',
		engine: 'manifold',
		icon: Fan
	},
	{
		slug: 'mini-base',
		title: m.tcat_mini_base_title,
		description: m.tcat_mini_base_description,
		category: 'make',
		engine: 'manifold',
		icon: Disc
	},
	{
		slug: 'wall-organizer',
		title: m.tcat_wall_organizer_title,
		description: m.tcat_wall_organizer_description,
		category: 'make',
		engine: 'manifold',
		icon: LayoutPanelTop
	},
	{
		slug: 'hinge-box',
		title: m.tcat_hinge_box_title,
		description: m.tcat_hinge_box_description,
		category: 'make',
		engine: 'manifold',
		icon: ArchiveRestore
	},
	{
		slug: 'deck-box',
		title: m.tcat_deck_box_title,
		description: m.tcat_deck_box_description,
		category: 'make',
		engine: 'manifold',
		icon: SquareStack
	},
	{
		slug: 'enclosure',
		title: m.tcat_enclosure_title,
		description: m.tcat_enclosure_description,
		category: 'make',
		engine: 'manifold',
		icon: Cpu
	},
	{
		slug: 'rack-panel',
		title: m.tcat_rack_panel_title,
		description: m.tcat_rack_panel_description,
		category: 'make',
		engine: 'manifold',
		icon: Server
	},
	{
		slug: 'keystone-plate',
		title: m.tcat_keystone_plate_title,
		description: m.tcat_keystone_plate_description,
		category: 'make',
		engine: 'manifold',
		icon: EthernetPort
	},
	{
		slug: 'keycap',
		title: m.tcat_keycap_title,
		description: m.tcat_keycap_description,
		category: 'make',
		engine: 'manifold',
		icon: Keyboard
	},
	{
		slug: 'coaster',
		title: m.tcat_coaster_title,
		description: m.tcat_coaster_description,
		category: 'make',
		engine: 'manifold',
		icon: Coffee
	},
	{
		slug: 'stamp',
		title: m.tcat_stamp_title,
		description: m.tcat_stamp_description,
		category: 'make',
		engine: 'manifold',
		icon: Stamp
	},
	{
		slug: 'planter',
		title: m.tcat_planter_title,
		description: m.tcat_planter_description,
		category: 'make',
		engine: 'manifold',
		icon: Sprout
	},
	{
		slug: 'basket',
		title: m.tcat_basket_title,
		description: m.tcat_basket_description,
		category: 'make',
		engine: 'manifold',
		icon: ShoppingBasket
	},
	{
		slug: 'lampshade',
		title: m.tcat_lampshade_title,
		description: m.tcat_lampshade_description,
		category: 'make',
		engine: 'manifold',
		icon: LampCeiling
	},
	{
		slug: 'bag-clip',
		title: m.tcat_bag_clip_title,
		description: m.tcat_bag_clip_description,
		category: 'make',
		engine: 'manifold',
		icon: Paperclip
	},
	{
		slug: 'lens-cap',
		title: m.tcat_lens_cap_title,
		description: m.tcat_lens_cap_description,
		category: 'make',
		engine: 'manifold',
		icon: Aperture
	},
	{
		slug: 'pencil-topper',
		title: m.tcat_pencil_topper_title,
		description: m.tcat_pencil_topper_description,
		category: 'make',
		engine: 'manifold',
		icon: Pencil
	},
	{
		slug: 'snowflake',
		title: m.tcat_snowflake_title,
		description: m.tcat_snowflake_description,
		category: 'make',
		engine: 'manifold',
		icon: Snowflake
	},
	{
		slug: 'kumiko',
		title: m.tcat_kumiko_title,
		description: m.tcat_kumiko_description,
		category: 'make',
		engine: 'manifold',
		icon: Hexagon
	},
	{
		slug: 'cake-topper',
		title: m.tcat_cake_topper_title,
		description: m.tcat_cake_topper_description,
		category: 'make',
		engine: 'manifold',
		icon: Cake
	},
	{
		slug: 'ornament',
		title: m.tcat_ornament_title,
		description: m.tcat_ornament_description,
		category: 'make',
		engine: 'manifold',
		icon: TreePine
	},
	{
		slug: 'letter-beads',
		title: m.tcat_letter_beads_title,
		description: m.tcat_letter_beads_description,
		category: 'make',
		engine: 'manifold',
		icon: CaseUpper
	},
	{
		slug: 'medal',
		title: m.tcat_medal_title,
		description: m.tcat_medal_description,
		category: 'make',
		engine: 'manifold',
		icon: Medal
	},
	{
		slug: 'bookmark',
		title: m.tcat_bookmark_title,
		description: m.tcat_bookmark_description,
		category: 'make',
		engine: 'manifold',
		icon: Bookmark
	},
	{
		slug: 'item-holder',
		title: m.tcat_item_holder_title,
		description: m.tcat_item_holder_description,
		category: 'make',
		engine: 'manifold',
		icon: Battery
	},
	{
		slug: 'tube-cap',
		title: m.tcat_tube_cap_title,
		description: m.tcat_tube_cap_description,
		category: 'make',
		engine: 'manifold',
		icon: SquareSquare
	},
	{
		slug: 'furniture-handle',
		title: m.tcat_furniture_handle_title,
		description: m.tcat_furniture_handle_description,
		category: 'make',
		engine: 'manifold',
		icon: GripHorizontal
	},
	{
		slug: 'phone-stand',
		title: m.tcat_phone_stand_title,
		description: m.tcat_phone_stand_description,
		category: 'make',
		engine: 'manifold',
		icon: Smartphone
	},
	{
		slug: 'shelf-bracket',
		title: m.tcat_shelf_bracket_title,
		description: m.tcat_shelf_bracket_description,
		category: 'make',
		engine: 'manifold',
		icon: CornerDownRight
	},
	{
		slug: 'print-hinge',
		title: m.tcat_print_hinge_title,
		description: m.tcat_print_hinge_description,
		category: 'make',
		engine: 'manifold',
		icon: DoorOpen
	},
	{
		slug: 'pipe-cover',
		title: m.tcat_pipe_cover_title,
		description: m.tcat_pipe_cover_description,
		category: 'make',
		engine: 'manifold',
		icon: CircleDashed
	},
	{
		slug: 'soap-dish',
		title: m.tcat_soap_dish_title,
		description: m.tcat_soap_dish_description,
		category: 'make',
		engine: 'manifold',
		icon: ShowerHead
	},
	{
		slug: 'measuring-cup',
		title: m.tcat_measuring_cup_title,
		description: m.tcat_measuring_cup_description,
		category: 'make',
		engine: 'manifold',
		icon: Beaker
	},
	{
		slug: 'ruler',
		title: m.tcat_ruler_title,
		description: m.tcat_ruler_description,
		category: 'make',
		engine: 'manifold',
		icon: Ruler
	},
	{
		slug: 'dice',
		title: m.tcat_dice_title,
		description: m.tcat_dice_description,
		category: 'make',
		engine: 'manifold',
		icon: Dices
	},
	{
		slug: 'fidget-spinner',
		title: m.tcat_fidget_spinner_title,
		description: m.tcat_fidget_spinner_description,
		category: 'make',
		engine: 'manifold',
		icon: Fan
	},
	{
		slug: 'jigsaw',
		title: m.tcat_jigsaw_title,
		description: m.tcat_jigsaw_description,
		category: 'make',
		engine: 'manifold',
		icon: Puzzle
	},
	{
		slug: 'name-puzzle',
		title: m.tcat_name_puzzle_title,
		description: m.tcat_name_puzzle_description,
		category: 'make',
		engine: 'manifold',
		icon: Baby
	},
	{
		slug: 'maze-box',
		title: m.tcat_maze_box_title,
		description: m.tcat_maze_box_description,
		category: 'make',
		engine: 'manifold',
		icon: Gift
	},
	// Uploaded model
	{
		slug: 'stl-viewer',
		title: m.tcat_stl_viewer_title,
		description: m.tcat_stl_viewer_description,
		category: 'mesh',
		engine: 'mesh',
		icon: ScanEye
	},
	{
		slug: 'stl-repair',
		title: m.tcat_stl_repair_title,
		description: m.tcat_stl_repair_description,
		category: 'mesh',
		engine: 'mesh',
		icon: Bandage
	},
	{
		slug: 'model-convert',
		title: m.tcat_model_convert_title,
		description: m.tcat_model_convert_description,
		category: 'mesh',
		engine: 'mesh',
		icon: ArrowRightLeft
	},
	{
		slug: 'model-resize',
		title: m.tcat_model_resize_title,
		description: m.tcat_model_resize_description,
		category: 'mesh',
		engine: 'mesh',
		icon: Scaling
	},
	{
		slug: 'model-simplify',
		title: m.tcat_model_simplify_title,
		description: m.tcat_model_simplify_description,
		category: 'mesh',
		engine: 'manifold',
		icon: Feather
	},
	{
		slug: 'stl-slicer',
		title: m.tcat_stl_slicer_title,
		description: m.tcat_stl_slicer_description,
		category: 'mesh',
		engine: 'manifold',
		icon: Scissors
	},
	{
		slug: 'big-print',
		title: m.tcat_big_print_title,
		description: m.tcat_big_print_description,
		category: 'mesh',
		engine: 'manifold',
		icon: Ungroup
	},
	{
		slug: 'stl-hollow',
		title: m.tcat_stl_hollow_title,
		description: m.tcat_stl_hollow_description,
		category: 'mesh',
		engine: 'manifold',
		icon: Gift
	},
	{
		slug: 'model-text',
		title: m.tcat_model_text_title,
		description: m.tcat_model_text_description,
		category: 'mesh',
		engine: 'manifold',
		icon: TypeOutline
	},
	{
		slug: 'mold-generator',
		title: m.tcat_mold_generator_title,
		description: m.tcat_mold_generator_description,
		category: 'mesh',
		engine: 'manifold',
		icon: PaintBucket
	},
	{
		slug: 'stl-texturizer',
		title: m.tcat_stl_texturizer_title,
		description: m.tcat_stl_texturizer_description,
		category: 'mesh',
		engine: 'mesh',
		icon: Waves
	},
	{
		slug: 'voxelizer',
		title: m.tcat_voxelizer_title,
		description: m.tcat_voxelizer_description,
		category: 'mesh',
		engine: 'mesh',
		icon: Boxes
	},
	{
		slug: 'flexi-maker',
		title: m.tcat_flexi_maker_title,
		description: m.tcat_flexi_maker_description,
		category: 'mesh',
		engine: 'manifold',
		icon: Link2
	},
	// Print
	{
		slug: 'tower-generator',
		title: m.tcat_tower_generator_title,
		description: m.tcat_tower_generator_description,
		category: 'print',
		engine: 'gcode',
		icon: Thermometer
	},
	{
		slug: 'test-prints',
		title: m.tcat_test_prints_title,
		description: m.tcat_test_prints_description,
		category: 'print',
		engine: 'manifold',
		icon: FlaskConical
	},
	{
		slug: 'bed-mesh',
		title: m.tcat_bed_mesh_title,
		description: m.tcat_bed_mesh_description,
		category: 'print',
		engine: 'calc',
		icon: LandPlot
	},
	{
		slug: 'printer-calcs',
		title: m.tcat_printer_calcs_title,
		description: m.tcat_printer_calcs_description,
		category: 'print',
		engine: 'calc',
		icon: Sigma
	},
	{
		slug: 'gcode-viewer',
		title: m.tcat_gcode_viewer_title,
		description: m.tcat_gcode_viewer_description,
		category: 'print',
		engine: 'gcode',
		icon: FileCode
	},
	{
		slug: 'gcode-edit',
		title: m.tcat_gcode_edit_title,
		description: m.tcat_gcode_edit_description,
		category: 'print',
		engine: 'gcode',
		icon: FilePen
	},
	{
		slug: 'calculator',
		title: m.tcat_calculator_title,
		description: m.tcat_calculator_description,
		category: 'print',
		engine: 'calc',
		icon: Calculator
	},
	{
		slug: 'spool-tracker',
		title: m.tcat_spool_tracker_title,
		description: m.tcat_spool_tracker_description,
		category: 'print',
		engine: 'calc',
		icon: Disc3
	},
	{
		slug: 'filament-swatch',
		title: m.tcat_filament_swatch_title,
		description: m.tcat_filament_swatch_description,
		category: 'print',
		engine: 'manifold',
		icon: SwatchBook
	},
	{
		slug: 'spool-holder',
		title: m.tcat_spool_holder_title,
		description: m.tcat_spool_holder_description,
		category: 'print',
		engine: 'manifold',
		icon: LoaderPinwheel
	},
	{
		slug: 'cable-chain',
		title: m.tcat_cable_chain_title,
		description: m.tcat_cable_chain_description,
		category: 'print',
		engine: 'manifold',
		icon: Link
	}
];

/** The tools, their texts in the language being rendered (getters over the messages). */
export const TOOLS: readonly ToolInfo[] = ENTRIES.map(({ title, description, ...rest }) => ({
	...rest,
	get title() {
		return title();
	},
	get description() {
		return description();
	}
}));

export function toolBySlug(slug: string): ToolInfo | undefined {
	return TOOLS.find((t) => t.slug === slug);
}
