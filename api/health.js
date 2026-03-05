module.exports = (req, res) => {
  res.status(200).json({
    status: 'ok',
    bot: 'aeo-prompt-tester',
    version: '1.0.0',
    platforms: ['chatgpt', 'perplexity', 'gemini', 'claude'],
    timestamp: new Date().toISOString(),
  });
};

