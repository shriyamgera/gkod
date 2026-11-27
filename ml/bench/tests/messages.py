"""Messages for the engine tests."""

from gkod_bench.prompts import Messages

ZERO = Messages(system="SYSTEM", turns=[{"role": "user", "content": "Make this part: a box"}])
THREE = Messages(
    system="SYSTEM",
    turns=[
        {"role": "user", "content": "Make this part: a"},
        {"role": "assistant", "content": "```openscad\ncube(1);\n```"},
        {"role": "user", "content": "Make this part: b"},
    ],
    shots=("x",),
)
