// Plain number, no range
plain = 12;
// Max only
capped = 4; // [10]
// Step only range
stepped = 2.5; // [0:0.5:10]
// Min max
span = 30; // [10:60]
// Dropdown
choice = 2; // [1, 2, 3]
label = "hi";
flag = true;
vec = [1, 2, 3];
small = 0.4;
neg = -5;
zero = 0;
/* [Hidden] */
$fn = 48;
cube([plain, span, stepped]);
