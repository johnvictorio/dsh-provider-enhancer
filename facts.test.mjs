import test from 'node:test'
import assert from 'node:assert/strict'
import { readModelFacts, mergeModels } from './host.js'

const ACCEPTED = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

test('capabilities.vision true maps to text and image input', () => {
  const facts = readModelFacts({
    id: 'deepseek-v4.1-flash',
    capabilities: { vision: true },
    reasoning: { effort_levels: [{ value: 'low', display: 'Low' }, { value: 'high', display: 'High' }, { value: 'xhigh', display: 'X-High' }] },
  }, ACCEPTED)
  assert.deepEqual(facts.vision, ['text', 'image'])
  assert.deepEqual(facts.reasoning, { low: 'low', high: 'high', xhigh: 'xhigh' })
})

test('capabilities.vision false maps to text-only input', () => {
  const facts = readModelFacts({
    id: 'deepseek-v4-pro-0813',
    capabilities: { vision: false },
    reasoning: { effort_levels: [{ value: 'low', display: 'Low' }, { value: 'max', display: 'Max' }] },
  }, ACCEPTED)
  assert.deepEqual(facts.vision, ['text'])
  assert.deepEqual(facts.reasoning, { low: 'low', max: 'max' })
})

test('capabilities without vision and without reasoning declare a text-only non-reasoning model', () => {
  const facts = readModelFacts({ id: 'plain', capabilities: {} }, ACCEPTED)
  assert.deepEqual(facts.vision, ['text'])
  assert.equal(facts.reasoning, false)
})

test('a row without capabilities states no facts', () => {
  const facts = readModelFacts({ id: 'mystery' }, ACCEPTED)
  assert.equal(facts.vision, undefined)
  assert.equal(facts.reasoning, undefined)
})

test('unusable effort levels keep the vision fact', () => {
  const facts = readModelFacts({
    id: 'odd',
    capabilities: { vision: true },
    reasoning: { effort_levels: ['wizard'] },
  }, ACCEPTED)
  assert.deepEqual(facts.vision, ['text', 'image'])
  assert.deepEqual(facts.unusable, ['wizard'])
})

test('an empty level vocabulary skips reasoning but keeps vision', () => {
  const facts = readModelFacts({ id: 'm', capabilities: { vision: true } }, [])
  assert.deepEqual(facts.vision, ['text', 'image'])
  assert.equal(facts.reasoning, undefined)
})

test('mergeModels fills the input gap from vision facts and keeps chosen lists', () => {
  const existing = [
    { id: 'a', name: 'A', reasoningEfforts: { high: 'high' } },
    { id: 'b', name: 'B', input: ['text'] },
  ]
  const discovered = [
    { id: 'a', name: 'A', contextWindow: 1048576, maxTokens: 262144 },
    { id: 'b', name: 'B', contextWindow: 1000000 },
    { id: 'c', name: 'C' },
  ]
  const facts = {
    reasoning: new Map([['a', { high: 'high' }]]),
    vision: new Map([['a', ['text', 'image']], ['b', ['text', 'image']], ['c', ['text']]]),
  }
  const merged = mergeModels(existing, discovered, facts, [])
  assert.deepEqual(merged.find((entry) => entry.id === 'a').input, ['text', 'image'])
  assert.deepEqual(merged.find((entry) => entry.id === 'b').input, ['text'])
  assert.deepEqual(merged.find((entry) => entry.id === 'c').input, ['text'])
  assert.deepEqual(merged.find((entry) => entry.id === 'a').reasoningEfforts, { high: 'high' })
})

test('mergeModels without facts leaves input untouched', () => {
  const merged = mergeModels([{ id: 'a' }], [{ id: 'a', name: 'A' }], undefined, [])
  assert.equal(merged[0].input, undefined)
})
