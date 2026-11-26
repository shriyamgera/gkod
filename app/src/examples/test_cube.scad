// Test cube: print it, then measure X, Y and Z with calipers. Each should come out at the size below.
// A small notch on the top edge marks the X side. Measure X from that side to the side opposite it,
// below the notch. Y is across the two sides without a notch.

// Cube size (mm)
size = 20; // [10:1:40]

/* [Hidden] */
notch_depth = 1;
notch_width = 5;
notch_height = 3;

difference() {
  cube(size);
  translate([size - notch_depth, (size - notch_width) / 2, size - notch_height])
    cube([notch_depth + 1, notch_width, notch_height + 1]);
}
