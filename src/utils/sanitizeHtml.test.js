import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitizeHtml';

describe('sanitizeHtml', () => {
  it('keeps the formatting the footer editor produces', () => {
    const html = '<b>Paid</b> <i>in</i> <u>full</u><br><font color="#dc2626">red</font>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('removes script tags together with their contents', () => {
    expect(sanitizeHtml('hi<script>alert(1)</script>there')).toBe('hithere');
  });

  it('strips event-handler attributes', () => {
    const out = sanitizeHtml('<img src=x onerror="alert(1)"><b onclick="alert(2)">bold</b>');
    expect(out).not.toMatch(/onerror|onclick|<img/i);
    expect(out).toContain('<b>bold</b>');
  });

  it('drops links and javascript: URLs but keeps the link text', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).toBe('click');
  });

  it('removes iframes, objects and svg payloads', () => {
    const out = sanitizeHtml('<iframe src="//evil"></iframe><object data="x"></object><svg onload="alert(1)"></svg>ok');
    expect(out).toBe('ok');
  });

  it('allows only safe inline style declarations', () => {
    const out = sanitizeHtml('<span style="color: red; background: url(javascript:alert(1)); position: fixed">x</span>');
    expect(out).toBe('<span style="color: red">x</span>');
  });

  it('rejects colour values that smuggle in other content', () => {
    const out = sanitizeHtml('<font color="red;background:url(x)">x</font>');
    expect(out).toBe('<font>x</font>');
  });

  it('escapes text that merely looks like markup', () => {
    expect(sanitizeHtml('1 &lt; 2 &amp; 3')).toBe('1 &lt; 2 &amp; 3');
  });

  it('returns an empty string for empty or non-string input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml({})).toBe('');
  });
});
