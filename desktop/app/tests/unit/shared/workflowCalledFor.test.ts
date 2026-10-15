import { describe, expect, it } from 'vitest';
import { workflowCalledFor } from '../../../src/shared/workflows';

const saved = [{ name: 'Order 66' }, { name: 'Morning routine' }, { name: 'Weekly tidy-up' }];
const call = (p: string) => workflowCalledFor(p, saved)?.name ?? null;

describe('running a saved workflow by saying its name', () => {
  it('runs it when that is the whole request', () => {
    expect(call('execute order 66')).toBe('Order 66');
    expect(call('Execute “Order 66”!')).toBe('Order 66');
    expect(call('order 66')).toBe('Order 66');
    expect(call('dex, run my morning routine')).toBe('Morning routine');
    expect(call('run the morning routine now')).toBe('Morning routine');
    expect(call('start weekly tidy-up')).toBe('Weekly tidy-up');
    expect(call('please do weekly tidy-up workflow')).toBe('Weekly tidy-up');
  });

  it('leaves anything more to the agent', () => {
    expect(call('execute order 66 but skip Chrome')).toBeNull();
    expect(call('what does order 66 do?')).toBeNull();
    expect(call('make a workflow called order 67')).toBeNull();
    expect(call('run my evening routine')).toBeNull();
    expect(call('')).toBeNull();
  });
});
