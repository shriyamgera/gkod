// Wall hook with two countersunk screw holes.
// Drawn lying on its side, the way it should be printed: layers run along the hook, so it is strong.

// Hook width (mm)
width = 20; // [10:1:40]
// Back plate height (mm)
plate_height = 80; // [70:1:140]
// How far the hook reaches out from the wall (mm)
reach = 25; // [10:1:50]
// Height of the upturned tip (mm)
tip = 14; // [8:1:20]
// Material thickness (mm)
thickness = 5; // [4:0.5:8]
// Screw shaft diameter (mm)
screw_d = 4; // [3:0.5:6]

/* [Hidden] */
$fn = 48;

arm_len = thickness + reach + thickness;
fillet = reach * 0.4;
// the lower screw sits above the tip and the fillet, so a screwdriver can reach it
lower_hole = thickness + max(tip, fillet) + screw_d + 1;
upper_hole = plate_height - screw_d - 3;

module profile() {
  // back plate, against the wall
  square([thickness, plate_height]);
  // arm with a rounded outer corner
  hull() {
    square([thickness, thickness]);
    translate([arm_len - thickness / 2, thickness / 2]) circle(d = thickness);
  }
  // upturned tip with a rounded end
  hull() {
    translate([arm_len - thickness / 2, thickness / 2]) circle(d = thickness);
    translate([arm_len - thickness / 2, thickness + tip - thickness / 2]) circle(d = thickness);
  }
  // fillet where the arm meets the plate
  polygon([
    [thickness, thickness],
    [thickness + fillet, thickness],
    [thickness, thickness + fillet],
  ]);
}

module screw_hole(y) {
  translate([0, y, width / 2]) rotate([0, 90, 0]) {
    translate([0, 0, -1]) cylinder(d = screw_d, h = thickness + 2);
    translate([0, 0, thickness - screw_d / 2])
      cylinder(d1 = screw_d, d2 = 2 * screw_d, h = screw_d / 2 + 0.01);
  }
}

difference() {
  linear_extrude(width) profile();
  screw_hole(lower_hole);
  screw_hole(upper_hole);
}
