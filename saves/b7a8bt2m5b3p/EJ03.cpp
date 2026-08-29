#include <cstring>
#include <fstream>
#include <iostream>
#include <string>

using namespace std;

string verificarInicio(string productoBuscar) {
    string linea = "";
    string aux="";
    ifstream file("Productos.txt", ios::in);
    if (!file.fail()) {S
        while (!file.eof()) {
            getline(file, linea);
            int c = 0;
            string us = "";
            string id2 = "";
            string pr = "";
            for (size_t i = 0; i < linea.size(); i++) {
                if (linea[i] == '|') {
                    c++;
                }
                if (linea[i] != '|' && c == 0) {
                    id2 += linea[i];
                }
                if (linea[i] != '|' && c == 1) {
                    us += linea[i];
                }
                if (linea[i] != '|' && c == 2) {
                    pr += linea[i];
                    
                }
            }
            if (productoBuscar == us) {
                return id2;
            } else if (productoBuscar == id2){
                return pr;
            }
        }
    }
    return "0";
}

bool escrituraUsuario(int id, string producto, string nombre) {
    ofstream file("Productos.txt", ios::app);
    if (file.is_open()) {
        file << id;
        file << "|";
        file << producto;
        file << "|";
        file << nombre << endl;

        file.close();
        return true;
    }
    return false;
}

bool guardarProductos(string producto, string nombre) {
    string linea = "";
    int id = 0;

    ifstream file("Productos.txt", ios::in);
    if (!file.fail()) {
        while (!file.eof()) {
            string stringID = "";
            getline(file, linea);
            for (size_t i = 0; i < linea.size(); i++) {
                if (linea[i] != '|') {
                    stringID = stringID + linea[i];

                } else {
                    break;
                }
            }

            if (!stringID.empty()) {
                int n = stoi(stringID);

                if (n >= id) {
                    n = n + 1;

                    id = n;
                }
            }
        }
    }
    if (escrituraUsuario(id, producto, nombre)) {
        return true;
    }
    return false;
}

bool validarOpcion(string pOpcion) {

    bool resultado = false;

    if (pOpcion >= "0" && pOpcion <= "2") {

        resultado = true;
    }

    return resultado;
}

int main() {
    string opcion = "";
    while (opcion != "0") {
        cout << "\n---Buscador de productos---\n" << endl;
        cout << "1-Producto a agregar " << endl;
        cout << "2-Producto a buscar " << endl;
        cout << "0-Salir" << endl;
        cout << "Ingrese una opción: ";
        cin >> opcion;
        cin.ignore();

        if (validarOpcion(opcion)) {

            if (opcion == "1") {
                string ProductoIngresar;
                string NombreIngresar;
                cout << "Ingrese producto: ";
                getline(cin, ProductoIngresar);
                cout << "\nIngrese nombre del responsable: ";
                getline(cin, NombreIngresar);
                if (guardarProductos(ProductoIngresar, NombreIngresar)) {
                    cout << "producto ingresado correctamente\n";
                }

            }

            else if (opcion == "2") {
                string productoBuscar;
                cout << "Ingrese el producto a buscar: ";
                getline(cin, productoBuscar);
                string auxi=verificarInicio(productoBuscar);
                cout<<"El id del producto es: "<<auxi;
                cout <<"\nEl responsable del producto es: "<<verificarInicio(auxi);

            } else {

                cout << "Opcion invalida. Intente nuevamente." << endl;
            }
        }
    }
    return 0;
}