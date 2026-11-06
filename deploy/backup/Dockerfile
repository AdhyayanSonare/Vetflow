FROM alpine:3.20
RUN apk add --no-cache postgresql17-client restic curl tzdata
COPY backup.sh restore.sh checksums.sql entrypoint.sh /opt/backup/
RUN chmod +x /opt/backup/*.sh
ENTRYPOINT ["/opt/backup/entrypoint.sh"]
