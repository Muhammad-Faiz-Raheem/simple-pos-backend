const crypto = require("crypto");

const authorizeLocalApi = (req, res, next) => {
  const expectedToken = process.env.LOCAL_API_TOKEN;
  const providedToken = req.get("X-Local-API-Token");

  if (!expectedToken || !providedToken) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized API request",
    });
  }

  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(providedToken);

  if (
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized API request",
    });
  }

  next();
};

module.exports = authorizeLocalApi;
