import { expect, test } from 'bun:test'
import plugin from '../.claude-plugin/plugin.json'
import { VERSION } from '../hooks/version'

test('VERSION matches plugin.json', () => {
  expect(VERSION).toBe(plugin.version)
})
