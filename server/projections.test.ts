// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { workspaceView } from './projections'
import { HttpError } from './http'
import { createWorkspace } from '../src/domain/workspace'

describe('the workspace read projection seam', () => {
  const state = createWorkspace({ name: 'Projection Studio', region: 'UK' })
  it('gives desk and management roles the whole studio record', () => {
    for (const role of ['owner', 'manager', 'reception'] as const)
      expect(workspaceView({ role, staffId: null }, state)).toBe(state)
  })
  it('refuses practitioners until their assigned-visit view exists', () => {
    expect(() => workspaceView({ role: 'practitioner', staffId: 'staff-1' }, state)).toThrow(
      HttpError,
    )
  })
})
