import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLightingPreset,
  LIGHTING_PRESET_KEYS,
  LIGHTING_PRESETS,
} from './lightingPresets';

test('lightingPresets defines all four requested PBR environment setups', () => {
  assert.equal(LIGHTING_PRESETS.length, 4);
  assert.deepEqual(
    LIGHTING_PRESETS.map((p) => p.label),
    [
      'Studio Soft',
      'Harsh Sunlight',
      'Night Operation (Cool Rim)',
      'Indoor Warehouse',
    ]
  );
  assert.deepEqual(
    LIGHTING_PRESETS.map((p) => p.id),
    [...LIGHTING_PRESET_KEYS]
  );
});

test('getLightingPreset resolves valid presets and falls back safely to Studio Soft', () => {
  const night = getLightingPreset('night_operation');
  assert.equal(night.id, 'night_operation');
  assert.ok(night.rimLight.intensity > night.keyLight.intensity * 3);

  const sun = getLightingPreset('harsh_sunlight');
  assert.ok(sun.keyLight.intensity > 3.5);
  assert.ok(sun.shadowFloorOpacity > 0.5);

  const warehouse = getLightingPreset('indoor_warehouse');
  assert.ok(warehouse.overheadSpot.intensity > 10);

  const fallback = getLightingPreset('nonexistent_preset');
  assert.equal(fallback.id, 'studio_soft');
});

test('every lighting preset has valid positive exposure, environment intensity, and 5 backdrop stops', () => {
  for (const preset of LIGHTING_PRESETS) {
    assert.ok(preset.exposure > 0.5 && preset.exposure < 2.0, `${preset.id} exposure`);
    assert.ok(
      preset.environmentIntensity > 0 && preset.environmentIntensity <= 1.5,
      `${preset.id} environmentIntensity`
    );
    assert.equal(preset.backdropStops.length, 5, `${preset.id} backdropStops`);
    assert.equal(preset.keyLight.position.length, 3, `${preset.id} keyLight pos`);
  }
});
