module.exports = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
          status: 'ok',
          bot: 'aeo-prompt-tester',
          version: '1.1.0',
          platforms: ['chatgpt', 'perplexity', 'gemini', 'claude'],
          timestamp: new Date().toISOString(),
    });
};
