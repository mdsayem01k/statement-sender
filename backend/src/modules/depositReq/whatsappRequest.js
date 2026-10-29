function rejected(data, statusCode) {
  const error = new Error(String(data.error || 'WhatsApp request rejected').split('\n')[0]);
  error.statusCode = statusCode || 502;
  error.errorType = 'WHATSAPP_REJECTED';
  error.definitelyNotSent = true;
  return error;
}

async function whatsappRequest(axios, url, payload, options) {
  let response;
  try {
    response = await axios.post(url, payload, options);
  } catch (error) {
    if (error.response?.data?.success === false) {
      throw rejected(error.response.data, error.response.status);
    }
    throw error;
  }
  if (response.data?.success === false) {
    throw rejected(response.data, response.status);
  }
  if (response.data?.success !== true) {
    const error = new Error('Uncertain WhatsApp response; verify before retrying');
    error.errorType = 'WHATSAPP_UNKNOWN';
    throw error;
  }
  return response.data;
}

module.exports = whatsappRequest;
