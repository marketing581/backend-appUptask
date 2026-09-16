import { CorsOptions } from 'cors'

export const corsConfig: CorsOptions = {
    /** Sin esto el navegador oculta la cabecera al JavaScript de la página, y
     *  en producción el frontend y la API están en dominios distintos: el
     *  listado paginado no sabría cuántos elementos hay en total. */
    exposedHeaders: ['X-Total-Count'],
    origin: function(origin, callback) {
        const whitelist = [process.env.FRONTEND_URL]

        if(process.argv[2] === '--api') {
            whitelist.push(undefined)
        }

        if(whitelist.includes(origin)) {
            callback(null, true)
        } else {
            callback(new Error('Error de CORS'))
        }
    }
}