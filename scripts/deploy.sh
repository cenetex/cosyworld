#!/bin/bash

set -e

DEPLOY_USER="deploy"
DEPLOY_HOST="moonstone-sanctum.com"
DEPLOY_PATH="/var/www/moonstone-sanctum"
DEPLOY_BRANCH="main"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${GREEN}Deploying CosyWorld to production${NC}"
echo -e "${YELLOW}Target: ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}${NC}"

echo -e "\n${GREEN}Step 1: Building the application${NC}"
npm run build

echo -e "\n${GREEN}Step 2: Creating deployment archive${NC}"
TIMESTAMP=$(date +%Y%m%d%H%M%S)
ARCHIVE_NAME="dist-${TIMESTAMP}.tar.gz"
tar -czf $ARCHIVE_NAME dist

echo -e "\n${GREEN}Step 3: Uploading to server${NC}"
scp $ARCHIVE_NAME ${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/

echo -e "\n${GREEN}Step 4: Deploying on server${NC}"
ssh ${DEPLOY_USER}@${DEPLOY_HOST} << EOF
  # Create backup of current deployment
  if [ -d ${DEPLOY_PATH}/dist ]; then
    BACKUP_NAME="backup-\$(date +%Y%m%d%H%M%S)"
    echo "Creating backup: \${BACKUP_NAME}"
    cp -r ${DEPLOY_PATH}/dist ${DEPLOY_PATH}/\${BACKUP_NAME}
  fi
  
  # Extract new files
  echo "Extracting new files"
  mkdir -p ${DEPLOY_PATH}
  tar -xzf /tmp/${ARCHIVE_NAME} -C ${DEPLOY_PATH}
  
  # Set permissions
  echo "Setting permissions"
  chmod -R 755 ${DEPLOY_PATH}/dist
  
  # Clean up
  echo "Cleaning up"
  rm /tmp/${ARCHIVE_NAME}
  
  # Reload web server
  echo "Reloading Nginx"
  sudo systemctl reload nginx
  
  # Restart application server
  echo "Restarting application server"
  sudo systemctl restart moonstone-sanctum
EOF

echo -e "\n${GREEN}Step 5: Cleaning up${NC}"
rm $ARCHIVE_NAME

echo -e "\n${GREEN}Deployment completed successfully!${NC}"
echo -e "Application is now available at https://${DEPLOY_HOST}"