export function processMessageLinks(message, client) {
  if (!message) return message;

  // Replace user mentions (@Username)
  const userMentionRegex = /@(\w+)/g;
  message = message.replace(userMentionRegex, (match, username) => {
    const user = client.users.cache.find(u => u.username.toLowerCase() === username.toLowerCase());
    return user ? `<@${user.id}>` : match;
  });

  // Replace channel names (#channel-name)
  const channelMentionRegex = /#([\w-]+)/g;
  message = message.replace(channelMentionRegex, (match, channelName) => {
    const channel = client.channels.cache.find(c => 
      c.name.toLowerCase() === channelName.toLowerCase()
    );
    return channel ? `<#${channel.id}>` : match;
  });

  // Process location/thread names using fuzzy matching
  const locationRegex = /\b(in|at|to) (the )?([A-Z][a-zA-Z\s]+)\b/g;
  message = message.replace(locationRegex, (match, prep, article, locationName) => {
    const thread = client.channels.cache.find(c => 
      c.isThread() && c.name.toLowerCase() === locationName.toLowerCase()
    );
    return thread ? 
      `${prep} ${article || ''}<#${thread.id}>` : 
      match;
  });

  return message;
}