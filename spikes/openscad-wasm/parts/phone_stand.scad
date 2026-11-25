// Phone stand: tilted back plate, base and front lip, rounded with hull/minkowski.
width = 80;        // stand width (mm)
depth = 90;        // base depth (mm)
height = 110;      // back plate height (mm)
thickness = 5;     // wall thickness (mm)
angle = 70;        // back plate angle from the table (degrees)
lip = 14;          // front lip height (mm)
round_r = 2;       // edge rounding radius (mm)
slot_w = 14;       // charging cable slot width (mm)
$fn = 24;

module rounded_plate(l, w, t, r) {
  // Rounded-edge plate: minkowski of a shrunk box with a sphere.
  minkowski() {
    translate([r, r, r]) cube([l - 2 * r, w - 2 * r, t - 2 * r]);
    sphere(r = r);
  }
}

module side_profile() {
  // Hull between rods at the base ends and the top of the back plate.
  rod = thickness;
  hull() {
    translate([0, 0, rod / 2]) rotate([0, 90, 0]) cylinder(d = rod, h = thickness);
    translate([0, depth, rod / 2]) rotate([0, 90, 0]) cylinder(d = rod, h = thickness);
  }
  hull() {
    translate([0, depth, rod / 2]) rotate([0, 90, 0]) cylinder(d = rod, h = thickness);
    translate([0, depth - height * cos(angle), height * sin(angle)])
      rotate([0, 90, 0]) cylinder(d = rod, h = thickness);
  }
}

difference() {
  union() {
    // base
    rounded_plate(width, depth, thickness, round_r);
    // back plate
    translate([0, depth, 0]) rotate([angle, 0, 0]) translate([0, -thickness, 0])
      rotate([90, 0, 0]) translate([0, 0, -thickness]) rounded_plate(width, height, thickness, round_r);
    // front lip
    translate([0, 18, 0]) rounded_plate(width, thickness, lip + thickness, round_r);
    // side ribs
    side_profile();
    translate([width - thickness, 0, 0]) side_profile();
  }
  // cable slot through the lip and base front
  translate([(width - slot_w) / 2, -1, -1]) cube([slot_w, 30, lip + thickness + 2]);
}
