import { describe, expect, it } from 'vitest'
import { signAws } from './aws'

// NEXT-13: AWS's own published examples. The keys are AWS's documented example keys, not real ones.
const keys = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
}
const now = new Date('2015-08-30T12:36:00Z')

describe('signing a request for AWS', () => {
  it('matches the test suite’s plain GET and POST', () => {
    const signed = (method: string) =>
      signAws({
        method,
        url: 'https://example.amazonaws.com/',
        headers: {},
        body: '',
        region: 'us-east-1',
        service: 'service',
        keys,
        now,
      })
    expect(signed('GET')).toEqual({
      'X-Amz-Date': '20150830T123600Z',
      Authorization:
        'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    })
    expect(signed('POST').Authorization).toMatch(
      /Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b$/,
    )
  })

  it('sorts the query, as in the test suite', () => {
    const { Authorization } = signAws({
      method: 'GET',
      url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1',
      headers: {},
      body: '',
      region: 'us-east-1',
      service: 'service',
      keys,
      now,
    })
    expect(Authorization).toMatch(
      /Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500$/,
    )
  })

  it('matches the IAM example in AWS’s guide, with a content type signed', () => {
    const { Authorization } = signAws({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: '',
      region: 'us-east-1',
      service: 'iam',
      keys,
      now,
    })
    expect(Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    )
  })

  it('signs a session token when there is one', () => {
    const headers = signAws({
      method: 'POST',
      url: 'https://email.eu-west-2.amazonaws.com/v2/email/outbound-emails',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      region: 'eu-west-2',
      service: 'ses',
      keys: { ...keys, sessionToken: 'token-example' },
      now,
    })
    expect(headers['X-Amz-Security-Token']).toBe('token-example')
    expect(headers.Authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-date;x-amz-security-token,',
    )
  })
})
