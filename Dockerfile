## Stage I: Configuring credentials and installing dependencies.

FROM node:12 as StageA

ARG SSH_PRIVATE_KEY
RUN mkdir /root/.ssh && \
    echo "${SSH_PRIVATE_KEY}" > /root/.ssh/id_rsa && \
    chmod u=rw,go= /root/.ssh/id_rsa && \
    ssh-keyscan gitlab.com >> /root/.ssh/known_hosts

ADD package.json package-lock.json /tmp/npm/
RUN cd /tmp/npm/ && \
    npm install

# Stage II: Preparing for runtime execution.
FROM node:12

ARG NODE_ENV=production
ARG COM=gocho.mugo
ARG APP=local-webhooks

ENV APP_DIR /opt/${COM}/${APP}

RUN mkdir -p ${APP_DIR}/data && \
    chown node:node ${APP_DIR}/data/
VOLUME ${APP_DIR}/data/
WORKDIR ${APP_DIR}

EXPOSE 8080
CMD ["npm", "start"]

COPY --from=stageA /tmp/npm/node_modules ${APP_DIR}/node_modules/
ADD . ${APP_DIR}/
