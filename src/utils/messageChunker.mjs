
export function chunkMessage(message, chunkSize = 2000) {
    if (!message) return [];
    // Split the message into paragraphs based on double line breaks
    const paragraphs = message.split(/\n\s*\n/);
    const chunks = [];
    let currentChunk = '';
  
    for (const paragraph of paragraphs) {
      const trimmedParagraph = paragraph.trim();
  
      // Check if adding the paragraph exceeds the chunk size
      if ((currentChunk + '\n\n' + trimmedParagraph).length <= chunkSize) {
        if (currentChunk) {
          currentChunk += '\n\n' + trimmedParagraph;
        } else {
          currentChunk = trimmedParagraph;
        }
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        // If the paragraph itself is larger than chunkSize, split it further
        if (trimmedParagraph.length <= chunkSize) {
          currentChunk = trimmedParagraph;
        } else {
          // Split the large paragraph into lines
          const lines = trimmedParagraph.split('\n');
          currentChunk = '';
  
          for (const line of lines) {
            const trimmedLine = line.trim();
            if ((currentChunk + '\n' + trimmedLine).length <= chunkSize) {
              if (currentChunk) {
                currentChunk += '\n' + trimmedLine;
              } else {
                currentChunk = trimmedLine;
              }
            } else {
              if (currentChunk) {
                chunks.push(currentChunk);
              }
              // If the line is still too big, split it into smaller chunks
              if (trimmedLine.length <= chunkSize) {
                currentChunk = trimmedLine;
              } else {
                const splitLine = trimmedLine.match(new RegExp(`.{1,${chunkSize}}`, 'g'));
                chunks.push(...splitLine.slice(0, -1));
                currentChunk = splitLine[splitLine.length - 1];
              }
            }
          }
        }
      }
    }
  
    if (currentChunk) {
      chunks.push(currentChunk);
    }
  
    return chunks;
  }