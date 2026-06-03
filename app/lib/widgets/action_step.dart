// One mono line in the conversation reflecting a single GUI action.
// Leading glyph carries the step's state -- queued, running, done, failed.

import 'package:flutter/material.dart';

import '../core/models/action_step.dart' as model;
import '../theme/tokens.dart';

class ActionStepLine extends StatelessWidget {
  const ActionStepLine({super.key, required this.step});
  final model.ActionStep step;

  @override
  Widget build(BuildContext context) {
    final (glyph, color) = _glyphAndColor(step.state);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 22,
            child: Text(glyph, style: DexType.mono(color: color)),
          ),
          Expanded(
            child: Text(
              step.text,
              style: DexType.mono(
                color: step.state == model.ActionStepState.queued
                    ? DexColors.textDim
                    : DexColors.text,
              ),
            ),
          ),
        ],
      ),
    );
  }

  (String, Color) _glyphAndColor(model.ActionStepState s) {
    switch (s) {
      case model.ActionStepState.queued:
        return (DexStepGlyph.queued, DexColors.textFaint);
      case model.ActionStepState.running:
        return (DexStepGlyph.running, DexColors.stateActing);
      case model.ActionStepState.done:
        return (DexStepGlyph.done, DexColors.stateApprove);
      case model.ActionStepState.failed:
        return (DexStepGlyph.failed, DexColors.stateError);
    }
  }
}
