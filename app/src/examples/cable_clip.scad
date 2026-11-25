// Cable clip: a flat pad for tape or glue with an open ring that a cable snaps into.
// Drawn lying on its side, the way it should be printed, so the ring needs no supports.

// Cable diameter (mm)
cable_d = 6; // [3:0.5:12]
// Ring wall thickness (mm)
wall = 1.6; // [1.2:0.2:3]
// Opening the cable is pushed through (mm)
opening = 4; // [1:0.5:10]
// Clip length along the cable (mm)
length = 12; // [6:1:30]
// Pad width (mm)
pad_width = 20; // [10:1:40]
// Pad thickness (mm)
pad_thickness = 2; // [1.5:0.5:5]

/* [Hidden] */
$fn = 64;

outer_r = cable_d / 2 + wall;
// the opening is always a little smaller than the cable, so the cable stays in
slot = min(opening, cable_d - 0.5);
ring_y = pad_thickness + outer_r - wall / 2;

module profile() {
  translate([-pad_width / 2, 0]) square([pad_width, pad_thickness]);
  difference() {
    translate([0, ring_y]) circle(r = outer_r);
    translate([0, ring_y]) circle(d = cable_d);
    translate([-slot / 2, ring_y]) square([slot, outer_r + 1]);
  }
}

linear_extrude(length) profile();
