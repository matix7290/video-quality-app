function phases(settings) {
  if (settings.mode !== 'both') return [settings.mode];
  if (settings.phaseSequence) return [...settings.phaseSequence];
  return settings.phaseOrder === 'slider-first' ? ['slider', 'standard'] : ['standard', 'slider'];
}
function phaseIntroKeys(phase) {
  return phase === 'standard' ? { title: 'standard_part_two', instruction: 'standard_instruction' }
    : { title: 'part_two', instruction: 'slider_instruction' };
}
module.exports = { phases, phaseIntroKeys };
