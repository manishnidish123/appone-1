cd ../
docker build -t ghcr.io/with-shrey/appone-app:${{ steps.vars.outputs.sha_short }} .
docker push ghcr.io/with-shrey/appone-app:${{ steps.vars.outputs.sha_short }}
