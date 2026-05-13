export interface ExportAnimationMeta {
  name: string;
  startIdx: number;
  count: number;
  fps: number;
  loop: boolean;
}

export function createUnityGuid(seed: string): string {
  return [
    fnv1a32(seed),
    fnv1a32(`${seed}::1`),
    fnv1a32(`${seed}::2`),
    fnv1a32(`${seed}::3`),
  ]
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('');
}

export function buildGodotAnimationEntries(
  animations: ExportAnimationMeta[],
  getFrameTextureRef: (frameIndex: number) => string,
): string {
  return animations.map((animation) => {
    const frameLines: string[] = [];
    for (let i = 0; i < animation.count; i++) {
      const idx = animation.startIdx + i;
      frameLines.push(`"duration": 1.0000,\n"texture": ${getFrameTextureRef(idx)}`);
    }

    return `{
"frames": [{
${frameLines.join('\n}, {\n')}
}],
"loop": ${animation.loop},
"name": &"${animation.name}",
"speed": ${animation.fps.toFixed(1)}
}`;
  }).join(', ');
}

export function buildUnityAnimationClip(params: {
  clipName: string;
  fps: number;
  loop: boolean;
  frameGuids: string[];
}): string {
  const sampleRate = params.fps;
  const frameTime = 1.0 / sampleRate;
  const keyframes = params.frameGuids.map((guid, index) => {
    return `        - time: ${(index * frameTime).toFixed(4)}
          value: {fileID: 21300000, guid: ${guid}, type: 3}`;
  }).join('\n');

  const wrapMode = params.loop ? 2 : 1;

  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!74 &7400000
AnimationClip:
  m_ObjectHideFlags: 0
  m_Name: ${params.clipName}
  serializedVersion: 7
  m_Legacy: 0
  m_Compressed: 0
  m_UseHighQualityCurve: 1
  m_RotationCurves: []
  m_CompressedRotationCurves: []
  m_EulerCurves: []
  m_PositionCurves: []
  m_ScaleCurves: []
  m_FloatCurves: []
  m_PPtrCurves:
    - curve:
${keyframes}
      attribute: m_Sprite
      path: ""
      classID: 212
      script: {fileID: 0}
      flags: 2
  m_SampleRate: ${sampleRate}
  m_WrapMode: ${wrapMode}
  m_Bounds:
    m_Center: {x: 0, y: 0, z: 0}
    m_Extent: {x: 0, y: 0, z: 0}
  m_AnimationClipSettings:
    serializedVersion: 2
    m_StartTime: 0
    m_StopTime: ${(params.frameGuids.length * frameTime).toFixed(4)}
    m_LoopTime: ${params.loop ? 1 : 0}
    m_WrapMode: ${wrapMode}
  m_EditorCurves: []
  m_EulerEditorCurves: []
  m_HasGenericRootTransform: 0
  m_HasMotionFloatCurves: 0
  m_Events: []
`;
}

export function buildUnitySpriteMeta(guid: string): string {
  return `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 13
  mipmaps:
    mipMapMode: 0
    enableMipMap: 0
    sRGBTexture: 1
    linearTexture: 0
    fadeOut: 0
    borderMipMap: 0
    mipMapsPreserveCoverage: 0
    alphaTestReferenceValue: 0.5
    mipMapFadeDistanceStart: 1
    mipMapFadeDistanceEnd: 3
  bumpmap:
    convertToNormalMap: 0
    externalNormalMap: 0
    heightScale: 0.25
    normalMapFilter: 0
    flipGreenChannel: 0
  isReadable: 0
  streamingMipmaps: 0
  streamingMipmapsPriority: 0
  vTOnly: 0
  ignoreMasterTextureLimit: 0
  grayScaleToAlpha: 0
  generateCubemap: 6
  cubemapConvolution: 0
  seamlessCubemap: 0
  textureFormat: 1
  maxTextureSize: 2048
  textureSettings:
    serializedVersion: 2
    filterMode: 0
    aniso: 0
    mipBias: 0
    wrapU: 1
    wrapV: 1
    wrapW: 1
  nPOTScale: 0
  lightmap: 0
  compressionQuality: 50
  spriteMode: 1
  spriteExtrude: 1
  spriteMeshType: 1
  alignment: 9
  spritePivot: {x: 0.5, y: 0}
  spritePixelsToUnits: 100
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  spriteGenerateFallbackPhysicsShape: 1
  alphaUsage: 1
  alphaIsTransparency: 1
  spriteTessellationDetail: -1
  textureType: 8
  textureShape: 1
  singleChannelComponent: 0
  flipbookRows: 1
  flipbookColumns: 1
  maxTextureSizeSet: 0
  compressionQualitySet: 0
  textureFormatSet: 0
  ignorePngGamma: 0
  applyGammaDecoding: 0
  swizzle: 50462976
  cookieLightType: 0
  platformSettings: []
  spriteSheet:
    serializedVersion: 2
    sprites: []
    outline: []
    customData: ""
    physicsShape: []
    bones: []
    spriteID: 00000000000000000000000000000000
    internalID: 0
    vertices: []
    indices: []
    edges: []
    weights: []
  spritePackingTag: ""
  pSDRemoveMatte: 0
  pSDShowRemoveMatteOption: 0
  userData: ""
  assetBundleName: ""
  assetBundleVariant: ""
`;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
