FROM node:18

ARG NODE_ENV=production
ARG COM=gochomugo
ARG APP=local-webhooks

ENV APP_DIR=/opt/${COM}/${APP}
ENV HTTP_PORT=8080
ENV NODE_ENV=${NODE_ENV}

RUN mkdir -p ${APP_DIR}/data && \
    chown node:node ${APP_DIR}/data/
VOLUME ${APP_DIR}/data/
WORKDIR ${APP_DIR}

EXPOSE ${HTTP_PORT}
CMD ["npm", "start"]
HEALTHCHECK CMD curl --fail http://localhost:${HTTP_PORT}/healthy || exit 1

ADD package.json package-lock.json ${APP_DIR}
RUN cd ${APP_DIR} && npm install

ADD . ${APP_DIR}/
