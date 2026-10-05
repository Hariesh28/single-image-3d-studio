# Models and third-party provenance

## Depth Anything V2 Metric Large

Official source repository:

- https://github.com/DepthAnything/Depth-Anything-V2

Pinned source commit used by this project:

```text
a561b849ebae10a6f5ef49e26c83cbbcd36c71bf
```

Metric models:

```text
Indoor:
depth-anything/Depth-Anything-V2-Metric-Hypersim-Large

depth_anything_v2_metric_hypersim_vitl.pth

Outdoor:
depth-anything/Depth-Anything-V2-Metric-VKITTI-Large

depth_anything_v2_metric_vkitti_vitl.pth
```

The official metric release documents these Large variants as ViT-L models for Hypersim indoor scenes and Virtual KITTI 2 outdoor scenes.

## License handling

The repository keeps model provenance separate from application code. Before distributing the project commercially, verify the current checkpoint license terms and the current licenses of all bundled/generated dependencies and the exact pinned model/source revision.

Do not remove upstream copyright/license notices from the downloaded Depth Anything V2 source under `vendor/`.
