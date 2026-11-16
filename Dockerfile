FROM node:22-alpine AS frontend
WORKDIR /build
COPY ui/package*.json ./
RUN npm ci --no-audit --no-fund
COPY ui/ ./
RUN npm run build

FROM php:8.4-apache

# GD lets the Dompdf fallback embed SimBrief's GIF/PNG/JPEG route maps
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpng-dev libjpeg62-turbo-dev \
    && docker-php-ext-configure gd --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" gd \
    && rm -rf /var/lib/apt/lists/*

COPY docker/efb.conf /etc/apache2/sites-available/000-default.conf
COPY docker/efb.ini /usr/local/etc/php/conf.d/efb.ini
# Sessions live on a volume so redeploys do not sign every pilot out
RUN mkdir -p /var/lib/php/sessions && chown www-data:www-data /var/lib/php/sessions && chmod 700 /var/lib/php/sessions
COPY index.php image_0.png image_1.png og-image.jpg /var/www/html/
COPY login-bg/ /var/www/html/login-bg/
COPY charts/ /var/www/html/charts/
COPY checklists/ /var/www/html/checklists/
COPY ops/index.php ops/generate_pdf.php ops/hoppie.php /var/www/html/ops/
COPY docker/hoppie_poll.php /usr/local/lib/ijv/hoppie_poll.php
RUN mkdir -p /var/lib/ijv-acars && chown www-data:www-data /var/lib/ijv-acars
COPY ops/dompdf/autoload.inc.php /var/www/html/ops/dompdf/
COPY ops/dompdf/vendor/ /var/www/html/ops/dompdf/vendor/
COPY --from=frontend /build/dist/ /var/www/html/ops/ui/
