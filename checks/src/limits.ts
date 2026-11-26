// Every threshold the checks use, with the reason for its value.

// Corners closer than this are the same corner: well above float rounding, well below any real feature.
export const WELD_MM = 1e-4;

// A triangle smaller than this has no real area and is left out of the area sums.
export const ZERO_AREA_MM2 = 1e-9;

// A closed surface enclosing less than this (a 0.1 mm cube) has nothing solid to print.
export const ZERO_VOLUME_MM3 = 1e-3;

// Sizes up to this much over the bed still fit: it only absorbs rounding.
export const FIT_SLACK_MM = 0.01;

// Faces this close to the lowest point are the first layer, the part that rests on the bed.
export const BED_LAYER_MM = 0.05;

// A part needs at least this much flat area on the bed (a 4.5 mm square) to stay put while printing.
export const MIN_CONTACT_MM2 = 20;

// A small part passes with less, as long as this share of its footprint is flat on the bed.
export const SMALL_PART_SHARE = 0.5;

// Any part needs at least this share of its footprint flat on the bed, so it cannot rock on a small patch.
export const MIN_CONTACT_SHARE = 0.01;

// Below this much flat area, the part only touches the bed at a point or along an edge.
export const POINT_CONTACT_MM2 = 5;

// Most printers print walls leaning up to 45 degrees from vertical without supports.
export const DEFAULT_OVERHANG_DEG = 45;

// Faces this little past the limit still pass: it only absorbs float rounding, so an exact 45 degree chamfer passes.
export const OVERHANG_TOLERANCE_DEG = 0.01;

// A surface underneath this close to the bed just sags onto it, which does no harm.
export const NEAR_BED_MM = 1;

// Overhang areas smaller than this are ignored when something holds them up: a tiny patch droops a little but does not fail.
export const MIN_OVERHANG_MM2 = 20;

// A point underneath can be this far from a wall that holds it up before it sags.
// So a 10 mm bridge and the top of a hole up to about 13 mm across print without supports.
export const MAX_REACH_MM = 5;

// A neighbouring face holds an overhang up when it goes at least this far below their shared edge.
// A wall only holds as well as it is held up itself: one that hangs from another overhang carries on that overhang's reach,
// less the height it rises.
export const SUPPORT_DROP_MM = 0.01;

// A long edge that holds an overhang up is measured in pieces this long, since what holds it up can change along it.
export const WALL_PIECE_MM = 2;

// The reach of a very large overhang area is measured on this many sample points at most, to keep the check fast.
export const MAX_REACH_SAMPLES = 4000;
