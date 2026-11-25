// Phone stand: base, tilted back plate with two side ribs, front lip with a cable slot.

// Stand width (mm)
width = 80; // [50:1:160]
// Base depth, front to back (mm)
depth = 90; // [70:1:140]
// Back plate length along the slope (mm)
height = 110; // [60:1:140]
// Back plate angle from the table (degrees)
angle = 70; // [55:1:80]
// Front lip height above the base (mm)
lip = 14; // [6:1:30]
// Wall thickness (mm)
thickness = 5; // [3:0.5:8]
// Charging cable slot width (mm)
cable_slot = 14; // [8:1:30]

/* [Hidden] */
// room between the lip and the back plate for the phone
gap = 16;

foot = thickness / sin(angle);
back_y = thickness + gap;
top_y = back_y + height * cos(angle);
top_z = height * sin(angle);

module side_profile() {
  square([depth, thickness]);
  square([thickness, thickness + lip]);
  polygon([
    [back_y, 0],
    [back_y + foot, 0],
    [top_y + foot, top_z],
    [top_y, top_z],
  ]);
}

// the rib starts and ends inside the back plate, so the two join as one solid
module rib_profile() {
  polygon([
    [back_y + foot / 2, 0],
    [max(depth, back_y + foot), 0],
    [back_y + foot / 2 + 0.6 * height * cos(angle), 0.6 * top_z],
  ]);
}

// turns a side view drawn in (y, z) into a solid running along x
module along_x(length) {
  rotate([90, 0, 90]) linear_extrude(length) children();
}

difference() {
  union() {
    along_x(width) side_profile();
    along_x(thickness) rib_profile();
    translate([width - thickness, 0, 0]) along_x(thickness) rib_profile();
  }
  translate([(width - cable_slot) / 2, -1, -1])
    cube([cable_slot, thickness + gap / 2 + 1, thickness + lip + 2]);
}
