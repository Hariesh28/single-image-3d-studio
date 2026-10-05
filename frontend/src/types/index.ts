export type Mode = 'image'|'depth'|'3d'|'split'|'compare'|'parallax'
export type ToolMode = 'inspect'|'measure'|'annotate'|'region'|'profile'
export type RegionShape = 'polygon'|'rectangle'|'lasso'
export type ColorMode = 'rgb'|'depth'|'height'|'normal'|'object'
export type CameraView = 'home'|'front'|'top'|'left'|'right'|'selected'
export type DepthDisplay = 'metric'|'inverse'|'log'

export interface Calibration { fx:number; fy:number; cx:number; cy:number; source:string; scale:number; fov_deg:number|null; fov_x_deg?:number; fov_y_deg?:number; quality?:{score:number;label:string}; scale_source?:string; distortion?:{k1:number;k2:number;p1:number;p2:number;k3:number} }
export interface PointInfo { pixel_x:number; pixel_y:number; requested_pixel_x?:number; requested_pixel_y?:number; snapped?:boolean; depth_m:number; x_m:number; y_m:number; z_m:number; radial_distance_m:number; quality:string; quality_score?:number; calibration_source:string; scale:number }
export interface Plane { id:number; normal:[number,number,number]; offset:number; inliers:number; center:[number,number,number]; curvature:number; threshold_m:number }
export interface SegObject { id:number; label:string; score:number; bbox_px:{x0:number;y0:number;x1:number;y1:number}; mask_artifact:string; pixel_count?:number; valid_depth_pixels?:number; depth_median_m?:number|null; depth_mean_m?:number|null; dimensions_m?:number[]|null; centroid_m?:number[]|null }
export interface Scene {
  scene_id:string; source_sha256:string; width:number; height:number; original_width:number; original_height:number; resize_scale:number;
  model:string; model_dataset:string; model_source_commit:string; scene_type:'indoor'|'outdoor'; scene_confidence:number; scene_selection_source:string;
  max_depth_m:number; depth_min_m:number; depth_max_m:number; depth_percentiles:Record<string,number>; point_counts:number[]; calibration:Calibration;
  planes:Plane[]; ground_plane:Plane|null; ground_transform:{rotation:number[][];translation:number[]}|null;
  quality:Record<string,any>; settings:Record<string,any>; analysis:Record<string,any>; segmentation:{status:string;model?:string;objects:SegObject[]}; artifacts:Record<string,string|null>; created_at:number
}
export interface SceneStatus { scene_id:string; status:'queued'|'processing'|'complete'|'failed'; progress:number; stage:string; message:string; error?:string|null; started_at?:number|null; finished_at?:number|null }
export interface SceneSummary { scene_id:string;width:number;height:number;scene_type:string;model:string;created_at:number;point_count:number;calibration_source:string }
export interface Cloud { count:number;width:number;height:number;positions:Float32Array;colors:Uint8Array;normals:Float32Array|null;pixels:Uint32Array;min:[number,number,number];max:[number,number,number] }
export interface Annotation { id:string; name:string; point:PointInfo; color:string; note:string }
export interface RegionResult { pixel_count:number;valid_depth_pixels:number;coverage_fraction:number;bbox_px:any;depth_median_m:number|null;depth_mean_m:number|null;xyz_min:number[]|null;xyz_max:number[]|null;dimensions_m:number[]|null;centroid_m?:number[]|null;surface_area_m2?:number|null;bbox_volume_m3?:number|null;polygon:[number,number][] }
export interface CrossSection { start:[number,number];end:[number,number];pixel_length:number;samples:number;points:(number[]|null)[];depth_m:(number|null)[];distance_m:number[];pixel_x:number[];pixel_y:number[] }
export interface Measurement { a:[number,number,number];b:[number,number,number];c?:[number,number,number];delta:[number,number,number];distance_m:number;horizontal_distance_m:number;vertical_difference_m:number;depth_difference_m:number;angle_deg?:number|null }
export interface Histogram { edges_m:number[]; counts:number[] }
