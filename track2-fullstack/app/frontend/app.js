const API_BASE = '/api';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml;
}

if (typeof module !== 'undefined') {
  module.exports = { escapeHtml };
}

async function parseErrorMessage(res, fallbackMessage) {
  try {
    const data = await res.json();
    if (data && typeof data.error === 'string') {
      return data.error;
    }
  } catch (err) {
    return fallbackMessage;
  }
  return fallbackMessage;
}

const api = {
  async get(path) {
    const res = await fetch(API_BASE + path);
    if (!res.ok) {
      const message = await parseErrorMessage(res, `GET ${path} failed (${res.status})`);
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const message = await parseErrorMessage(res, `POST ${path} failed (${res.status})`);
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    return res.json();
  },
  async put(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const message = await parseErrorMessage(res, `PUT ${path} failed (${res.status})`);
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    return res.json();
  },
  async delete(path) {
    const res = await fetch(API_BASE + path, { method: 'DELETE' });
    if (!res.ok) {
      const message = await parseErrorMessage(res, `DELETE ${path} failed (${res.status})`);
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    return res.json();
  },
};
