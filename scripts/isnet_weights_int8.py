#!/usr/bin/env python3
# Makes vendor/rembg/isnet-general-use-w8.onnx from rembg's isnet-general-use.onnx (see vendor/rembg/README.md):
#   pip install onnx numpy && python3 scripts/isnet_weights_int8.py isnet-general-use.onnx vendor/rembg/isnet-general-use-w8.onnx
# Weight-only per-channel int8: Conv weights stored as int8 + a scale per output channel, DequantizeLinear restores
# float32 at run time. Activations stay float32, so accuracy stays close to the original. Keeps only output_image.
import sys, numpy as np, onnx
from onnx import numpy_helper, helper, TensorProto
src, dst = sys.argv[1:3]
m = onnx.load(src)
g = m.graph
# keep only the main output
keep = [o for o in g.output if o.name == "output_image"]
del g.output[:]; g.output.extend(keep)
inits = {i.name: i for i in g.initializer}
conv_w = {n.input[1] for n in g.node if n.op_type == "Conv"}
new_nodes, total, packed = [], 0, 0
for name in conv_w:
    t = inits[name]; w = numpy_helper.to_array(t).astype(np.float32)
    total += w.nbytes
    flat = w.reshape(w.shape[0], -1)
    scale = np.abs(flat).max(axis=1) / 127.0
    scale[scale == 0] = 1e-8
    q = np.clip(np.round(flat / scale[:, None]), -127, 127).astype(np.int8).reshape(w.shape)
    g.initializer.remove(t)
    g.initializer.extend([numpy_helper.from_array(q, name + "_q"), numpy_helper.from_array(scale.astype(np.float32), name + "_s"),
                          numpy_helper.from_array(np.zeros(w.shape[0], np.int8), name + "_z")])
    new_nodes.append(helper.make_node("DequantizeLinear", [name + "_q", name + "_s", name + "_z"], [name], axis=0, name=name + "_dq"))
    packed += q.nbytes
for n in reversed(new_nodes): g.node.insert(0, n)
# drop nodes that no longer feed the output
needed = {o.name for o in g.output}; live = []
for n in reversed(list(g.node)):
    if any(o in needed for o in n.output):
        live.append(n); needed.update(i for i in n.input if i)
live.reverse(); del g.node[:]; g.node.extend(live)
used = needed; kept = [i for i in g.initializer if i.name in used]
del g.initializer[:]; g.initializer.extend(kept)
onnx.checker.check_model(m)
onnx.save(m, dst)
print(f"conv weights {total/1e6:.1f} MB -> {packed/1e6:.1f} MB, nodes {len(g.node)}")
