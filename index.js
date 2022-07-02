const express = require('express');
const app = express();
const cors = require('cors');
const ibov = require("./api/ibovespa.api");

app.use(express.json({ extended: false }));
app.use(cors({
    credentials: true
}));
app.use('/api/ibovespa', ibov)

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server is running in port: ${PORT}`))